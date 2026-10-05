package httpserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	// Vite puts content-hashed file names under assets/, so a URL there never changes meaning.
	cacheImmutable = "public, max-age=31536000, immutable"
	// Everything else (index.html, favicon, manifest) must be revalidated so a deploy shows up at once.
	cacheRevalidate = "no-cache"
	cacheNone       = "no-store"
)

// precompressed lists the sibling extensions that hold precompressed copies of a file, in server
// preference order.
var precompressed = [...]struct{ ext, encoding string }{
	{".br", "br"},
	{".gz", "gzip"},
}

// contentTypes pins the types the build emits. mime.TypeByExtension alone would depend on the host's
// MIME database, which may lack .mjs or .webmanifest or give .js a legacy type; with nosniff, a
// module script or worker served with the wrong type does not run.
var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".map":         "application/json",
	".webmanifest": "application/manifest+json",
	".wasm":        "application/wasm",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".gif":         "image/gif",
	".webp":        "image/webp",
	".avif":        "image/avif",
	".ico":         "image/x-icon",
	".woff2":       "font/woff2",
	".woff":        "font/woff",
	".ttf":         "font/ttf",
	".otf":         "font/otf",
	".txt":         "text/plain; charset=utf-8",
	".xml":         "application/xml",
	".pdf":         "application/pdf",
}

// uiNotBuiltPage is served in place of index.html when the binary was built without the web app.
const uiNotBuiltPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PhotoBrick: UI not built</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#1c1d22;background:#fff}
code{font:0.9em ui-monospace,monospace;background:#eee;padding:0.1em 0.3em;border-radius:3px}
@media (prefers-color-scheme:dark){body{color:#e8e8ea;background:#1c1d22}code{background:#33343a}}
</style>
</head>
<body>
<h1>UI not built</h1>
<p>This PhotoBrick server was compiled without the web app, so there is nothing to show yet.</p>
<p>Run <code>make web</code> and then <code>make go-build</code> (or just <code>make build</code>). That builds the
app into <code>server/internal/webui/dist</code> and embeds it in the binary.</p>
<p>For development you don't need this server: <code>pnpm dev</code> serves the app with hot reload.</p>
</body>
</html>
`

// representation is one servable byte sequence for a URL: the file itself or a precompressed sibling.
type representation struct {
	name     string // path in the file system
	encoding string // Content-Encoding value, "" for the file itself
	etag     string
	size     int64
}

// asset is a file of the web build together with its precompressed siblings.
type asset struct {
	contentType  string
	cacheControl string
	identity     representation
	encoded      []representation // in server preference order
}

// staticHandler serves the web build: exact file hits, and index.html for client-side routes.
// The file system is indexed once at startup; the embedded build never changes at run time.
type staticHandler struct {
	fsys   fs.FS
	assets map[string]*asset // keyed by path without the leading slash
	index  *asset            // nil when the build has no index.html
}

func newStatic(fsys fs.FS) (*staticHandler, error) {
	assets, err := indexAssets(fsys)
	if err != nil {
		return nil, err
	}
	return &staticHandler{fsys: fsys, assets: assets, index: assets["index.html"]}, nil
}

// indexAssets describes every servable file. Hidden files (a path segment starting with a dot,
// except .well-known) are left out, and so are precompressed siblings, which are only ever served
// in place of their original.
func indexAssets(fsys fs.FS) (map[string]*asset, error) {
	var names []string
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name != "." && isHidden(d.Name()) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.Type().IsRegular() {
			names = append(names, name)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("index web build: %w", err)
	}

	present := make(map[string]bool, len(names))
	for _, name := range names {
		present[name] = true
	}
	assets := make(map[string]*asset, len(names))
	for _, name := range names {
		if isPrecompressedSibling(name, present) {
			continue
		}
		a := &asset{contentType: contentType(name), cacheControl: cacheControl(name)}
		if a.identity, err = describe(fsys, name, ""); err != nil {
			return nil, err
		}
		for _, p := range precompressed {
			if !present[name+p.ext] {
				continue
			}
			rep, err := describe(fsys, name+p.ext, p.encoding)
			if err != nil {
				return nil, err
			}
			a.encoded = append(a.encoded, rep)
		}
		assets[name] = a
	}
	return assets, nil
}

func isHidden(base string) bool {
	return strings.HasPrefix(base, ".") && base != ".well-known"
}

func isPrecompressedSibling(name string, present map[string]bool) bool {
	for _, p := range precompressed {
		if base, ok := strings.CutSuffix(name, p.ext); ok && present[base] {
			return true
		}
	}
	return false
}

// describe hashes a file for its strong ETag. Each representation gets its own ETag, as RFC 9110
// requires when the bytes differ.
func describe(fsys fs.FS, name, encoding string) (representation, error) {
	f, err := fsys.Open(name)
	if err != nil {
		return representation{}, fmt.Errorf("index web build: %w", err)
	}
	defer f.Close()
	h := sha256.New()
	size, err := io.Copy(h, f)
	if err != nil {
		return representation{}, fmt.Errorf("index web build: read %s: %w", name, err)
	}
	sum := h.Sum(nil)
	etag := `"` + base64.RawURLEncoding.EncodeToString(sum[:12]) + `"`
	return representation{name: name, encoding: encoding, etag: etag, size: size}, nil
}

func contentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if ct, ok := contentTypes[ext]; ok {
		return ct
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func cacheControl(name string) string {
	if strings.HasPrefix(name, "assets/") {
		return cacheImmutable
	}
	return cacheRevalidate
}

func (s *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		errorResponse(w, http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		s.serveShell(w, r)
		return
	}
	if a := s.assets[name]; a != nil {
		s.serveAsset(w, r, a)
		return
	}
	// A missing file under assets/ or with an extension is a real 404: answering a stale chunk or
	// image URL with index.html would only surface as a confusing MIME or parse error.
	if name == "assets" || strings.HasPrefix(name, "assets/") || path.Ext(name) != "" {
		errorResponse(w, http.StatusNotFound)
		return
	}
	// Anything else is a client-side route, but only for clients that want a page.
	w.Header().Add("Vary", "Accept")
	if !acceptsHTML(r.Header.Values("Accept")) {
		errorResponse(w, http.StatusNotFound)
		return
	}
	s.serveShell(w, r)
}

// serveShell serves index.html, or the "UI not built" page when the binary has no web build.
func (s *staticHandler) serveShell(w http.ResponseWriter, r *http.Request) {
	if s.index != nil {
		s.serveAsset(w, r, s.index)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", cacheNone)
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = io.WriteString(w, uiNotBuiltPage)
}

func (s *staticHandler) serveAsset(w http.ResponseWriter, r *http.Request, a *asset) {
	h := w.Header()
	rep := a.identity
	if len(a.encoded) > 0 {
		h.Add("Vary", "Accept-Encoding")
		if enc, ok := chooseEncoding(r.Header.Values("Accept-Encoding"), a.encoded); ok {
			rep = enc
		}
	}
	f, err := s.fsys.Open(rep.name)
	if err != nil {
		errorResponse(w, http.StatusInternalServerError)
		return
	}
	defer f.Close()
	content, ok := f.(io.ReadSeeker)
	if !ok {
		// embed.FS and fstest.MapFS files are seekable; this keeps other fs.FS implementations working.
		data, err := io.ReadAll(f)
		if err != nil {
			errorResponse(w, http.StatusInternalServerError)
			return
		}
		content = bytes.NewReader(data)
	}

	h.Set("Content-Type", a.contentType)
	h.Set("Cache-Control", a.cacheControl)
	h.Set("ETag", rep.etag)
	if rep.encoding != "" {
		h.Set("Content-Encoding", rep.encoding)
		// ServeContent leaves Content-Length unset on full responses once Content-Encoding is set.
		// It overwrites this for range responses and removes it for 304 and error responses.
		h.Set("Content-Length", strconv.FormatInt(rep.size, 10))
	}
	// The embedded build has no modification times; the ETag drives conditional requests.
	http.ServeContent(w, r, "", time.Time{}, content)
}

// errorResponse writes a short plain-text error that no cache keeps: a 404 for an asset may turn
// into a 200 at the next deploy.
func errorResponse(w http.ResponseWriter, code int) {
	w.Header().Set("Cache-Control", cacheNone)
	http.Error(w, http.StatusText(code), code)
}
