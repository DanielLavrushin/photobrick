package httpserver

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
)

const indexHTML = "<!doctype html><title>PhotoBrick</title><div id=root></div>"

func testUI() fstest.MapFS {
	file := func(s string) *fstest.MapFile { return &fstest.MapFile{Data: []byte(s)} }
	return fstest.MapFS{
		"index.html":                           file(indexHTML),
		"favicon.svg":                          file("<svg xmlns='http://www.w3.org/2000/svg'/>"),
		"manifest.webmanifest":                 file(`{"name":"PhotoBrick"}`),
		"robots.txt":                           file("User-agent: *\n"),
		"assets/index-B1x2y3.js":               file("console.log('identity')"),
		"assets/index-B1x2y3.js.br":            file("BR"),
		"assets/index-B1x2y3.js.gz":            file("GZIP"),
		"assets/index-C4d5e6.css":              file("body{}"),
		"assets/engine.worker-D7e8f9.mjs":      file("self.onmessage=()=>{}"),
		"assets/kernel-E0f1a2.wasm":            file("\x00asm\x01\x00\x00\x00"),
		"assets/roboto-latin-400-F3a4b5.woff2": file("wOF2"),
		"assets/logo-A6b7c8.png":               file("\x89PNG"),
		"assets/_plugin-helper-G9h0i1.js":      file("export{}"),
		"assets/blob-H2i3j4.unknownext":        file("?"),
		".gitkeep":                             file(""),
		".well-known/security.txt":             file("Contact: mailto:security@example.org\n"),
		".secret/key.txt":                      file("do not serve"),
		"assets/.hidden.js":                    file("do not serve"),
		"orphan.txt.gz":                        file("GZIP without an original"),
	}
}

func newTestHandler(t *testing.T, ui fs.FS) http.Handler {
	t.Helper()
	h, err := New(Options{UI: ui})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return h
}

func request(h http.Handler, method, target string, header ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, nil)
	for i := 0; i+1 < len(header); i += 2 {
		r.Header.Set(header[i], header[i+1])
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestContentTypes(t *testing.T) {
	h := newTestHandler(t, testUI())
	tests := []struct{ path, want string }{
		{"/", "text/html; charset=utf-8"},
		{"/index.html", "text/html; charset=utf-8"},
		{"/assets/index-B1x2y3.js", "text/javascript; charset=utf-8"},
		{"/assets/engine.worker-D7e8f9.mjs", "text/javascript; charset=utf-8"},
		{"/assets/index-C4d5e6.css", "text/css; charset=utf-8"},
		{"/assets/kernel-E0f1a2.wasm", "application/wasm"},
		{"/assets/roboto-latin-400-F3a4b5.woff2", "font/woff2"},
		{"/assets/logo-A6b7c8.png", "image/png"},
		{"/favicon.svg", "image/svg+xml"},
		{"/manifest.webmanifest", "application/manifest+json"},
		{"/robots.txt", "text/plain; charset=utf-8"},
		{"/assets/blob-H2i3j4.unknownext", "application/octet-stream"},
	}
	for _, tt := range tests {
		w := request(h, http.MethodGet, tt.path)
		if w.Code != http.StatusOK {
			t.Errorf("GET %s: status %d, want 200", tt.path, w.Code)
			continue
		}
		if got := w.Header().Get("Content-Type"); got != tt.want {
			t.Errorf("GET %s: Content-Type %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestCacheControl(t *testing.T) {
	h := newTestHandler(t, testUI())
	tests := []struct{ path, want string }{
		{"/assets/index-B1x2y3.js", "public, max-age=31536000, immutable"},
		{"/assets/index-C4d5e6.css", "public, max-age=31536000, immutable"},
		{"/assets/_plugin-helper-G9h0i1.js", "public, max-age=31536000, immutable"},
		{"/", "no-cache"},
		{"/index.html", "no-cache"},
		{"/favicon.svg", "no-cache"},
		{"/manifest.webmanifest", "no-cache"},
		{"/some/client/route", "no-cache"},
		{"/assets/missing-X.js", "no-store"},
	}
	for _, tt := range tests {
		w := request(h, http.MethodGet, tt.path, "Accept", "text/html")
		if got := w.Header().Get("Cache-Control"); got != tt.want {
			t.Errorf("GET %s: Cache-Control %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestSPAFallback(t *testing.T) {
	h := newTestHandler(t, testUI())
	tests := []struct {
		name, method, path, accept string
		want                       int // status; 200 means index.html
	}{
		{"browser navigation", "GET", "/editor", "text/html,application/xhtml+xml,*/*;q=0.8", 200},
		{"nested route", "GET", "/m/abc123/edit", "text/html", 200},
		{"trailing slash", "GET", "/help/", "text/html", 200},
		{"HEAD", "HEAD", "/editor", "text/html", 200},
		{"no Accept header", "GET", "/editor", "", 200},
		{"wildcard", "GET", "/editor", "*/*", 200},
		{"text wildcard", "GET", "/editor", "text/*", 200},
		{"html refused", "GET", "/editor", "text/html;q=0, */*", 404},
		{"json only", "GET", "/editor", "application/json", 404},
		{"missing file with extension", "GET", "/missing.png", "text/html", 404},
		{"missing html file", "GET", "/about.html", "text/html", 404},
		{"missing hashed chunk", "GET", "/assets/index-OLD.js", "*/*", 404},
		{"extensionless under assets", "GET", "/assets/missing", "text/html", 404},
		{"assets directory", "GET", "/assets/", "text/html", 404},
		{"assets without slash", "GET", "/assets", "text/html", 404},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var header []string
			if tt.accept != "" {
				header = []string{"Accept", tt.accept}
			}
			w := request(h, tt.method, tt.path, header...)
			if w.Code != tt.want {
				t.Fatalf("%s %s: status %d, want %d", tt.method, tt.path, w.Code, tt.want)
			}
			if tt.want != http.StatusOK {
				return
			}
			if got := w.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
				t.Errorf("Content-Type %q", got)
			}
			wantBody := indexHTML
			if tt.method == http.MethodHead {
				wantBody = ""
			}
			if got := w.Body.String(); got != wantBody {
				t.Errorf("body %q, want %q", got, wantBody)
			}
		})
	}
}

func TestSPAFallbackVariesOnAccept(t *testing.T) {
	h := newTestHandler(t, testUI())
	for _, accept := range []string{"text/html", "application/json"} {
		w := request(h, http.MethodGet, "/editor", "Accept", accept)
		if got := w.Header().Values("Vary"); len(got) != 1 || got[0] != "Accept" {
			t.Errorf("Accept %q: Vary %q, want [Accept]", accept, got)
		}
	}
	// An exact hit does not depend on Accept.
	if got := request(h, http.MethodGet, "/").Header().Values("Vary"); len(got) != 0 {
		t.Errorf("GET /: Vary %q, want none", got)
	}
}

func TestHiddenAndVariantFilesAreNotServed(t *testing.T) {
	h := newTestHandler(t, testUI())
	for _, p := range []string{
		"/.gitkeep",
		"/.secret/key.txt",
		"/assets/.hidden.js",
		"/assets/index-B1x2y3.js.br",
		"/assets/index-B1x2y3.js.gz",
	} {
		if w := request(h, http.MethodGet, p, "Accept", "text/html"); w.Code != http.StatusNotFound {
			t.Errorf("GET %s: status %d, want 404", p, w.Code)
		}
	}
	for _, p := range []string{"/.well-known/security.txt", "/orphan.txt.gz", "/assets/_plugin-helper-G9h0i1.js"} {
		if w := request(h, http.MethodGet, p); w.Code != http.StatusOK {
			t.Errorf("GET %s: status %d, want 200", p, w.Code)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	h := newTestHandler(t, testUI())
	for _, method := range []string{"POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
		for _, p := range []string{"/", "/index.html", "/assets/index-B1x2y3.js", "/editor", "/missing.png", "/healthz"} {
			w := request(h, method, p, "Accept", "text/html")
			if w.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s: status %d, want 405", method, p, w.Code)
				continue
			}
			if got := w.Header().Get("Allow"); got != "GET, HEAD" {
				t.Errorf("%s %s: Allow %q, want %q", method, p, got, "GET, HEAD")
			}
		}
	}
}

func TestAPIIsReserved(t *testing.T) {
	h := newTestHandler(t, testUI())
	for _, method := range []string{"GET", "POST", "DELETE"} {
		for _, p := range []string{"/api", "/api/", "/api/share", "/api/share/AbCdEf"} {
			w := request(h, method, p, "Accept", "text/html")
			if w.Code != http.StatusNotFound {
				t.Errorf("%s %s: status %d, want 404", method, p, w.Code)
			}
			if strings.Contains(w.Body.String(), "<title>") {
				t.Errorf("%s %s: got the SPA shell", method, p)
			}
		}
	}
}

func TestHead(t *testing.T) {
	h := newTestHandler(t, testUI())
	w := request(h, http.MethodHead, "/")
	if w.Code != http.StatusOK || w.Body.Len() != 0 {
		t.Fatalf("HEAD /: status %d, body %d bytes", w.Code, w.Body.Len())
	}
	if got, want := w.Header().Get("Content-Length"), strconv.Itoa(len(indexHTML)); got != want {
		t.Errorf("HEAD /: Content-Length %q, want %q", got, want)
	}
}

func TestConditionalGet(t *testing.T) {
	h := newTestHandler(t, testUI())
	first := request(h, http.MethodGet, "/")
	etag := first.Header().Get("ETag")
	if !strings.HasPrefix(etag, `"`) || len(etag) < 10 {
		t.Fatalf("ETag %q is not a strong entity tag", etag)
	}
	if other := request(h, http.MethodGet, "/favicon.svg").Header().Get("ETag"); other == etag {
		t.Errorf("different files share ETag %s", etag)
	}
	for _, p := range []string{"/", "/index.html", "/editor"} {
		w := request(h, http.MethodGet, p, "If-None-Match", etag, "Accept", "text/html")
		if w.Code != http.StatusNotModified || w.Body.Len() != 0 {
			t.Errorf("GET %s with If-None-Match: status %d, body %d bytes, want 304 and no body", p, w.Code, w.Body.Len())
		}
	}
	if w := request(h, http.MethodGet, "/", "If-None-Match", `"stale"`); w.Code != http.StatusOK {
		t.Errorf("stale If-None-Match: status %d, want 200", w.Code)
	}
}

func TestPathCleaningRedirects(t *testing.T) {
	h := newTestHandler(t, testUI())
	w := request(h, http.MethodGet, "/assets/../index.html")
	// ServeMux redirects to the cleaned path (307 since Go 1.22), so ".." never reaches the handler.
	if w.Code/100 != 3 || w.Header().Get("Location") != "/index.html" {
		t.Errorf("status %d, Location %q; want a redirect to /index.html", w.Code, w.Header().Get("Location"))
	}
}

func TestMissingUI(t *testing.T) {
	h := newTestHandler(t, fstest.MapFS{".gitkeep": {}})
	for _, p := range []string{"/", "/editor"} {
		w := request(h, http.MethodGet, p, "Accept", "text/html")
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("GET %s: status %d, want 503", p, w.Code)
		}
		if got := w.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
			t.Errorf("GET %s: Content-Type %q", p, got)
		}
		if got := w.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("GET %s: Cache-Control %q, want no-store", p, got)
		}
		if body := w.Body.String(); !strings.Contains(body, "UI not built") || !strings.Contains(body, "make web") {
			t.Errorf("GET %s: body does not explain how to build the UI:\n%s", p, body)
		}
	}
	for p, want := range map[string]int{
		"/healthz":     http.StatusOK,
		"/index.html":  http.StatusNotFound,
		"/assets/x.js": http.StatusNotFound,
		"/.gitkeep":    http.StatusNotFound,
		"/favicon.ico": http.StatusNotFound,
		"/editor?x=1":  http.StatusServiceUnavailable,
	} {
		if w := request(h, http.MethodGet, p, "Accept", "text/html"); w.Code != want {
			t.Errorf("GET %s: status %d, want %d", p, w.Code, want)
		}
	}
	if w := request(h, http.MethodPost, "/"); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /: status %d, want 405", w.Code)
	}
}

func TestNewRejectsNilUI(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Fatal("New with a nil UI succeeded")
	}
}

// failingFS fails to open one file, like a corrupt or unreadable build directory.
type failingFS struct {
	fstest.MapFS
	bad string
}

var errBroken = errors.New("broken")

func (f failingFS) Open(name string) (fs.File, error) {
	if name == f.bad {
		return nil, errBroken
	}
	return f.MapFS.Open(name)
}

func TestNewReportsUnreadableFiles(t *testing.T) {
	_, err := New(Options{UI: failingFS{MapFS: testUI(), bad: "favicon.svg"}})
	if !errors.Is(err, errBroken) {
		t.Fatalf("New: err = %v, want errBroken", err)
	}
}

// plainFS hides the Seek method of its files, like fs.FS implementations that can't seek.
type plainFS struct{ fstest.MapFS }

type plainFile struct{ fs.File }

func (p plainFS) Open(name string) (fs.File, error) {
	f, err := p.MapFS.Open(name)
	if err != nil {
		return nil, err
	}
	return plainFile{f}, nil
}

func TestServesNonSeekableFiles(t *testing.T) {
	h := newTestHandler(t, plainFS{testUI()})
	if _, ok := io.Reader(plainFile{}).(io.Seeker); ok {
		t.Fatal("plainFile must not be seekable")
	}
	w := request(h, http.MethodGet, "/")
	if w.Code != http.StatusOK || w.Body.String() != indexHTML {
		t.Fatalf("GET /: status %d, body %q", w.Code, w.Body.String())
	}
}
