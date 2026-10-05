// Package httpserver implements PhotoBrick's HTTP handler: the embedded web app with an SPA
// fallback, /healthz, security headers and access logging.
package httpserver

import (
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
)

// Options configures New.
type Options struct {
	// UI is the web build with index.html at its root. Without index.html, "/" and client-side
	// routes answer 503 with a page that explains how to build the UI; /healthz keeps working.
	UI fs.FS
	// Logger receives one access-log line per request. Nil disables access logging.
	Logger *slog.Logger
}

// New returns the root handler. It reads the whole UI file system once to index it.
func New(opts Options) (http.Handler, error) {
	if opts.UI == nil {
		return nil, errors.New("httpserver: Options.UI is nil")
	}
	static, err := newStatic(opts.UI)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz) // GET patterns match HEAD too
	// /api is reserved for the share service. Until it exists, every method gets a 404 there,
	// never the SPA fallback or a 405.
	mux.HandleFunc("/api", apiNotFound)
	mux.HandleFunc("/api/", apiNotFound)
	mux.Handle("/", static)

	h := withSecurityHeaders(mux)
	if opts.Logger != nil {
		h = withAccessLog(h, opts.Logger)
	}
	return h, nil
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/plain; charset=utf-8")
	h.Set("Cache-Control", cacheNone)
	_, _ = io.WriteString(w, "ok")
}

func apiNotFound(w http.ResponseWriter, _ *http.Request) {
	errorResponse(w, http.StatusNotFound)
}
