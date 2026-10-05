package httpserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

const compressedJS = "/assets/index-B1x2y3.js"

func TestPrecompressedSelection(t *testing.T) {
	h := newTestHandler(t, testUI())
	tests := []struct {
		acceptEncoding string
		wantEncoding   string // "" is the uncompressed file
		wantBody       string
	}{
		{"", "", "console.log('identity')"},
		{"identity", "", "console.log('identity')"},
		{"gzip, deflate, br, zstd", "br", "BR"},
		{"gzip, br", "br", "BR"}, // equal weights: server preference
		{"br", "br", "BR"},
		{"gzip", "gzip", "GZIP"},
		{"x-gzip", "gzip", "GZIP"},
		{"GZIP", "gzip", "GZIP"},
		{"br;q=0, gzip", "gzip", "GZIP"},
		{"gzip;q=1.0, br;q=0.5", "gzip", "GZIP"},
		{"gzip;q=0.2, br;q=0.8", "br", "BR"},
		{"*", "br", "BR"},
		{"*;q=0.5, br;q=0", "gzip", "GZIP"},
		{"*;q=0", "", "console.log('identity')"},
		{"deflate, zstd", "", "console.log('identity')"},
		{"br;q=0, gzip;q=0", "", "console.log('identity')"},
	}
	for _, tt := range tests {
		var header []string
		if tt.acceptEncoding != "" {
			header = []string{"Accept-Encoding", tt.acceptEncoding}
		}
		w := request(h, http.MethodGet, compressedJS, header...)
		if w.Code != http.StatusOK {
			t.Errorf("Accept-Encoding %q: status %d", tt.acceptEncoding, w.Code)
			continue
		}
		if got := w.Header().Get("Content-Encoding"); got != tt.wantEncoding {
			t.Errorf("Accept-Encoding %q: Content-Encoding %q, want %q", tt.acceptEncoding, got, tt.wantEncoding)
		}
		if got := w.Body.String(); got != tt.wantBody {
			t.Errorf("Accept-Encoding %q: body %q, want %q", tt.acceptEncoding, got, tt.wantBody)
		}
		if got := w.Header().Values("Vary"); len(got) != 1 || got[0] != "Accept-Encoding" {
			t.Errorf("Accept-Encoding %q: Vary %q, want [Accept-Encoding]", tt.acceptEncoding, got)
		}
		// The encoding changes the bytes, not the media type or the caching policy.
		if got := w.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
			t.Errorf("Accept-Encoding %q: Content-Type %q", tt.acceptEncoding, got)
		}
		if got := w.Header().Get("Cache-Control"); got != cacheImmutable {
			t.Errorf("Accept-Encoding %q: Cache-Control %q", tt.acceptEncoding, got)
		}
	}
}

func TestNoVaryWithoutPrecompressedSiblings(t *testing.T) {
	h := newTestHandler(t, testUI())
	w := request(h, http.MethodGet, "/assets/index-C4d5e6.css", "Accept-Encoding", "gzip, br")
	if got := w.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding %q, want none", got)
	}
	if got := w.Header().Values("Vary"); len(got) != 0 {
		t.Errorf("Vary %q, want none", got)
	}
}

func TestPrecompressedETagsDiffer(t *testing.T) {
	h := newTestHandler(t, testUI())
	seen := map[string]string{}
	for _, ae := range []string{"", "gzip", "br"} {
		etag := request(h, http.MethodGet, compressedJS, "Accept-Encoding", ae).Header().Get("ETag")
		if prev, dup := seen[etag]; dup {
			t.Errorf("Accept-Encoding %q and %q share ETag %s", prev, ae, etag)
		}
		seen[etag] = ae
	}
}

func TestPrecompressedConditionalGet(t *testing.T) {
	h := newTestHandler(t, testUI())
	brETag := request(h, http.MethodGet, compressedJS, "Accept-Encoding", "br").Header().Get("ETag")

	w := request(h, http.MethodGet, compressedJS, "Accept-Encoding", "br", "If-None-Match", brETag)
	if w.Code != http.StatusNotModified {
		t.Fatalf("br revalidation: status %d, want 304", w.Code)
	}
	for _, name := range []string{"Content-Length", "Content-Encoding"} {
		if got := w.Header().Get(name); got != "" {
			t.Errorf("304 carries %s: %q", name, got)
		}
	}
	// A cached br body must not validate a gzip response.
	if w := request(h, http.MethodGet, compressedJS, "Accept-Encoding", "gzip", "If-None-Match", brETag); w.Code != http.StatusOK {
		t.Errorf("gzip request with the br ETag: status %d, want 200", w.Code)
	}
}

func TestPrecompressedRange(t *testing.T) {
	h := newTestHandler(t, testUI())
	w := request(h, http.MethodGet, compressedJS, "Accept-Encoding", "gzip", "Range", "bytes=1-2")
	if w.Code != http.StatusPartialContent {
		t.Fatalf("status %d, want 206", w.Code)
	}
	if got := w.Body.String(); got != "ZI" {
		t.Errorf("body %q, want %q", got, "ZI")
	}
	if got := w.Header().Get("Content-Length"); got != "2" {
		t.Errorf("Content-Length %q, want 2", got)
	}
	if got := w.Header().Get("Content-Range"); got != "bytes 1-2/4" {
		t.Errorf("Content-Range %q, want %q", got, "bytes 1-2/4")
	}
}

// TestPrecompressedOverTheWire checks the real server response: a precompressed body must go out
// with Content-Length, not chunked, and HEAD must report the same length.
func TestPrecompressedOverTheWire(t *testing.T) {
	srv := httptest.NewServer(newTestHandler(t, testUI()))
	defer srv.Close()
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}

	for _, method := range []string{http.MethodGet, http.MethodHead} {
		req, err := http.NewRequestWithContext(t.Context(), method, srv.URL+compressedJS, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Accept-Encoding", "gzip")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if resp.Header.Get("Content-Encoding") != "gzip" {
			t.Errorf("%s: Content-Encoding %q", method, resp.Header.Get("Content-Encoding"))
		}
		if resp.ContentLength != 4 || len(resp.TransferEncoding) != 0 {
			t.Errorf("%s: Content-Length %d, Transfer-Encoding %q; want 4 and none", method, resp.ContentLength, resp.TransferEncoding)
		}
		wantBody := "GZIP"
		if method == http.MethodHead {
			wantBody = ""
		}
		if string(body) != wantBody {
			t.Errorf("%s: body %q, want %q", method, body, wantBody)
		}
	}
}
