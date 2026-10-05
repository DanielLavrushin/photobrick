package httpserver

import (
	"log/slog"
	"net/http"
	"time"
)

// contentSecurityPolicy allows only same-origin code. blob: covers the photo preview and object-URL
// workers; 'unsafe-inline' styles are needed by emotion, which MUI uses to inject <style> tags.
const contentSecurityPolicy = "default-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; " +
	"script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; " +
	"object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"

var securityHeaders = [...][2]string{
	{"Content-Security-Policy", contentSecurityPolicy},
	{"X-Content-Type-Options", "nosniff"},
	{"Referrer-Policy", "strict-origin-when-cross-origin"},
	{"Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()"},
	{"Cross-Origin-Opener-Policy", "same-origin"},
}

// withSecurityHeaders sets the security headers on every response, errors included.
func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		for _, kv := range securityHeaders {
			h.Set(kv[0], kv[1])
		}
		next.ServeHTTP(w, r)
	})
}

// withAccessLog logs one line per request. It logs the path only: query strings (and future share
// links) may carry user data that must not end up in logs.
func withAccessLog(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &responseRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		status := rec.status
		if status == 0 {
			status = http.StatusOK // net/http sends 200 when the handler writes nothing
		}
		bytes := rec.bytes
		if r.Method == http.MethodHead {
			bytes = 0 // net/http accepts and discards body writes for HEAD
		}
		logger.LogAttrs(r.Context(), slog.LevelInfo, "request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", status),
			slog.Int64("bytes", bytes),
			slog.Duration("duration", time.Since(start)),
		)
	})
}

// responseRecorder captures the final status code and the body size.
type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (rec *responseRecorder) WriteHeader(code int) {
	// 1xx responses are interim; the first final status is what the client gets.
	if rec.status == 0 && code >= 200 {
		rec.status = code
	}
	rec.ResponseWriter.WriteHeader(code)
}

func (rec *responseRecorder) Write(p []byte) (int, error) {
	if rec.status == 0 {
		rec.status = http.StatusOK
	}
	n, err := rec.ResponseWriter.Write(p)
	rec.bytes += int64(n)
	return n, err
}

// Unwrap lets http.ResponseController reach the underlying writer (flush, deadlines).
func (rec *responseRecorder) Unwrap() http.ResponseWriter {
	return rec.ResponseWriter
}
