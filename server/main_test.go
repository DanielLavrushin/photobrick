package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"flag"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func env(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestParseConfig(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		env      map[string]string
		wantAddr string
		wantVer  bool
	}{
		{"defaults", nil, nil, "127.0.0.1:8080", false},
		{"env", nil, map[string]string{"PHOTOBRICK_ADDR": ":9000"}, ":9000", false},
		{"flag beats env", []string{"-addr", "127.0.0.1:9001"}, map[string]string{"PHOTOBRICK_ADDR": ":9000"}, "127.0.0.1:9001", false},
		{"version", []string{"-version"}, nil, "127.0.0.1:8080", true},
	}
	for _, tt := range tests {
		cfg, err := parseConfig(tt.args, env(tt.env), io.Discard)
		if err != nil {
			t.Errorf("%s: %v", tt.name, err)
			continue
		}
		if cfg.addr != tt.wantAddr || cfg.showVersion != tt.wantVer {
			t.Errorf("%s: got %+v, want addr %q version %v", tt.name, cfg, tt.wantAddr, tt.wantVer)
		}
	}
}

func TestParseConfigUsageErrors(t *testing.T) {
	for _, args := range [][]string{{"-nope"}, {"serve"}, {"-addr"}} {
		var out bytes.Buffer
		_, err := parseConfig(args, env(nil), &out)
		var ue usageError
		if !errors.As(err, &ue) {
			t.Errorf("%q: err = %v, want a usageError", args, err)
		}
		if !strings.Contains(out.String(), "Usage: photobrick") {
			t.Errorf("%q: usage not printed; output %q", args, out.String())
		}
	}
	var out bytes.Buffer
	if _, err := parseConfig([]string{"-h"}, env(nil), &out); !errors.Is(err, flag.ErrHelp) {
		t.Errorf("-h: err = %v, want flag.ErrHelp", err)
	}
	if !strings.Contains(out.String(), "PHOTOBRICK_ADDR") {
		t.Errorf("-h output does not mention PHOTOBRICK_ADDR: %q", out.String())
	}
}

func TestRunVersion(t *testing.T) {
	old := version
	version = "v1.2.3-test"
	defer func() { version = old }()

	var stdout, stderr bytes.Buffer
	if err := run(t.Context(), []string{"-version"}, env(nil), &stdout, &stderr); err != nil {
		t.Fatal(err)
	}
	if got := stdout.String(); got != "photobrick v1.2.3-test\n" {
		t.Errorf("stdout %q", got)
	}
	if stderr.Len() != 0 {
		t.Errorf("unexpected stderr %q", stderr.String())
	}
}

func TestRunListenError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	err = run(t.Context(), []string{"-addr", ln.Addr().String()}, env(nil), io.Discard, io.Discard)
	if err == nil {
		t.Fatal("run succeeded on an address that is in use")
	}
}

// TestRunServesAndStops runs the real binary entry point with the real embedded UI (built or not),
// reads the bound address from the "listening" log line, and stops it by cancelling the context.
func TestRunServesAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	logs, logw := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, nil, env(map[string]string{"PHOTOBRICK_ADDR": "127.0.0.1:0"}), io.Discard, logw)
		_ = logw.Close()
	}()

	lines := bufio.NewScanner(logs)
	var addr string
	for addr == "" && lines.Scan() {
		for field := range strings.FieldsSeq(lines.Text()) {
			if a, ok := strings.CutPrefix(field, "addr="); ok && strings.Contains(lines.Text(), "msg=listening") {
				addr = a
			}
		}
	}
	if addr == "" {
		t.Fatalf("no listening line; run returned %v", <-done)
	}
	var rest bytes.Buffer
	drained := make(chan struct{})
	go func() {
		for lines.Scan() {
			rest.WriteString(lines.Text() + "\n")
		}
		close(drained)
	}()

	resp, err := http.Get("http://" + addr + "/healthz?probe=1")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "ok" {
		t.Fatalf("GET /healthz: status %d, body %q", resp.StatusCode, body)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not return after cancel")
	}
	<-drained
	log := rest.String()
	for _, want := range []string{"msg=request", "path=/healthz", "status=200", "msg=\"shutting down\"", "msg=stopped"} {
		if !strings.Contains(log, want) {
			t.Errorf("log lacks %q:\n%s", want, log)
		}
	}
	if strings.Contains(log, "probe") {
		t.Errorf("query string logged:\n%s", log)
	}
}

func TestServeWaitsForInFlightRequests(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "finished")
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.DiscardHandler)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- serve(ctx, newHTTPServer(handler, logger), ln, logger) }()

	type result struct {
		body string
		err  error
	}
	got := make(chan result, 1)
	go func() {
		resp, err := http.Get("http://" + ln.Addr().String() + "/")
		if err != nil {
			got <- result{err: err}
			return
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		got <- result{string(b), err}
	}()

	<-started
	cancel()
	select {
	case err := <-done:
		t.Fatalf("serve returned (%v) while a request was in flight", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)

	if r := <-got; r.err != nil || r.body != "finished" {
		t.Fatalf("in-flight request: body %q, err %v", r.body, r.err)
	}
	if err := <-done; err != nil {
		t.Fatalf("serve: %v", err)
	}
	if _, err := net.DialTimeout("tcp", ln.Addr().String(), time.Second); err == nil {
		t.Error("server still accepts connections after shutdown")
	}
}
