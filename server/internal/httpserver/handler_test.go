package httpserver

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHealthz(t *testing.T) {
	// /healthz must not depend on the UI being built.
	for name, ui := range map[string]fstest.MapFS{"built": testUI(), "not built": {".gitkeep": {}}} {
		h := newTestHandler(t, ui)
		w := request(h, http.MethodGet, "/healthz")
		if w.Code != http.StatusOK || w.Body.String() != "ok" {
			t.Errorf("%s: GET /healthz: status %d, body %q", name, w.Code, w.Body.String())
		}
		if got := w.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
			t.Errorf("%s: Content-Type %q", name, got)
		}
		if got := w.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control %q, want no-store", name, got)
		}
		if w := request(h, http.MethodHead, "/healthz"); w.Code != http.StatusOK {
			t.Errorf("%s: HEAD /healthz: status %d", name, w.Code)
		}
	}
}

func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	want := map[string]string{
		"Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; " +
			"script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; " +
			"object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
		"X-Content-Type-Options":     "nosniff",
		"Referrer-Policy":            "strict-origin-when-cross-origin",
		"Permissions-Policy":         "camera=(), microphone=(), geolocation=(), interest-cohort=()",
		"Cross-Origin-Opener-Policy": "same-origin",
	}
	built := newTestHandler(t, testUI())
	notBuilt := newTestHandler(t, fstest.MapFS{".gitkeep": {}})
	cases := []struct {
		name         string
		h            http.Handler
		method, path string
		status       int
	}{
		{"index", built, "GET", "/", 200},
		{"asset", built, "GET", "/assets/index-C4d5e6.css", 200},
		{"spa fallback", built, "GET", "/editor", 200},
		{"not modified", built, "GET", "/favicon.svg", 304},
		{"not found", built, "GET", "/missing.png", 404},
		{"api", built, "POST", "/api/share", 404},
		{"method not allowed", built, "DELETE", "/", 405},
		{"redirect", built, "GET", "/a/../b", 307},
		{"healthz", built, "GET", "/healthz", 200},
		{"ui not built", notBuilt, "GET", "/", 503},
	}
	favicon := request(built, http.MethodGet, "/favicon.svg").Header().Get("ETag")
	for _, c := range cases {
		w := request(c.h, c.method, c.path, "Accept", "text/html", "If-None-Match", favicon)
		if w.Code != c.status {
			t.Errorf("%s: status %d, want %d", c.name, w.Code, c.status)
		}
		for k, v := range want {
			if got := w.Header().Values(k); len(got) != 1 || got[0] != v {
				t.Errorf("%s: %s = %q, want %q", c.name, k, got, v)
			}
		}
	}
}

func TestAccessLog(t *testing.T) {
	var buf bytes.Buffer
	h, err := New(Options{UI: testUI(), Logger: slog.New(slog.NewJSONHandler(&buf, nil))})
	if err != nil {
		t.Fatal(err)
	}
	type entry struct {
		Msg      string `json:"msg"`
		Method   string `json:"method"`
		Path     string `json:"path"`
		Status   int    `json:"status"`
		Bytes    int64  `json:"bytes"`
		Duration *int64 `json:"duration"`
	}
	tests := []struct {
		method, target string
		want           entry
	}{
		{"GET", "/editor?token=s3cr3t&photo=x", entry{Method: "GET", Path: "/editor", Status: 200, Bytes: int64(len(indexHTML))}},
		{"HEAD", "/", entry{Method: "HEAD", Path: "/", Status: 200}},
		{"GET", "/missing.png?q=s3cr3t", entry{Method: "GET", Path: "/missing.png", Status: 404, Bytes: int64(len("Not Found\n"))}},
		{"PUT", "/", entry{Method: "PUT", Path: "/", Status: 405, Bytes: int64(len("Method Not Allowed\n"))}},
		{"GET", "/healthz", entry{Method: "GET", Path: "/healthz", Status: 200, Bytes: 2}},
	}
	for _, tt := range tests {
		buf.Reset()
		request(h, tt.method, tt.target, "Accept", "text/html")
		lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
		if len(lines) != 1 {
			t.Errorf("%s %s: %d log lines, want 1:\n%s", tt.method, tt.target, len(lines), buf.String())
			continue
		}
		if strings.Contains(lines[0], "s3cr3t") || strings.Contains(lines[0], "token") {
			t.Errorf("%s %s: the query string leaked into the log: %s", tt.method, tt.target, lines[0])
		}
		var got entry
		if err := json.Unmarshal([]byte(lines[0]), &got); err != nil {
			t.Fatalf("parse %q: %v", lines[0], err)
		}
		if got.Duration == nil {
			t.Errorf("%s %s: no duration in %s", tt.method, tt.target, lines[0])
		}
		got.Duration = nil
		tt.want.Msg = "request"
		if got != tt.want {
			t.Errorf("%s %s: logged %+v, want %+v", tt.method, tt.target, got, tt.want)
		}
	}
}

func TestResponseRecorderIgnoresInterimStatus(t *testing.T) {
	var buf bytes.Buffer
	h := withAccessLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusEarlyHints)
		w.WriteHeader(http.StatusTeapot)
		w.WriteHeader(http.StatusOK) // superfluous; the client already got 418
	}), slog.New(slog.NewTextHandler(&buf, nil)))
	request(h, http.MethodGet, "/")
	if !strings.Contains(buf.String(), "status=418") {
		t.Errorf("log line %q does not record status 418", buf.String())
	}
}
