// Command photobrick serves the PhotoBrick web app, which is embedded in the binary at build time.
//
// Usage:
//
//	photobrick [-addr host:port] [-version]
//
// The listen address defaults to 127.0.0.1:8080 and can also be set with PHOTOBRICK_ADDR; the flag
// wins. In production it runs behind Caddy, which terminates TLS and compresses responses.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/daniellavrushin/photobrick/server/internal/httpserver"
	"github.com/daniellavrushin/photobrick/server/internal/webui"
)

// version is set at build time: go build -ldflags "-X main.version=v0.1.0".
var version = "dev"

const (
	defaultAddr = "127.0.0.1:8080"
	// shutdownTimeout bounds how long in-flight requests may take after SIGINT/SIGTERM. Keep it
	// below TimeoutStopSec in deploy/photobrick.service.
	shutdownTimeout = 10 * time.Second
)

type config struct {
	addr        string
	showVersion bool
}

// usageError marks invalid command-line usage; the problem and the usage text are already printed.
type usageError struct{ err error }

func (e usageError) Error() string { return e.err.Error() }
func (e usageError) Unwrap() error { return e.err }

func main() {
	err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdout, os.Stderr)
	if err == nil || errors.Is(err, flag.ErrHelp) {
		return
	}
	var ue usageError
	if errors.As(err, &ue) {
		os.Exit(2)
	}
	fmt.Fprintf(os.Stderr, "photobrick: %v\n", err)
	os.Exit(1)
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout, stderr io.Writer) error {
	cfg, err := parseConfig(args, getenv, stderr)
	if err != nil {
		return err
	}
	if cfg.showVersion {
		_, err := fmt.Fprintf(stdout, "photobrick %s\n", buildVersion())
		return err
	}

	logger := slog.New(slog.NewTextHandler(stderr, nil))
	ui := webui.FS()
	handler, err := httpserver.New(httpserver.Options{UI: ui, Logger: logger})
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	// After the first signal, restore default handling so a second Ctrl+C kills the process at once.
	context.AfterFunc(ctx, stop)

	ln, err := net.Listen("tcp", cfg.addr)
	if err != nil {
		return err
	}
	if _, err := fs.Stat(ui, "index.html"); err != nil {
		logger.Warn("web UI not built: / answers 503 until you run `make web` and rebuild the server")
	}
	logger.Info("listening", "addr", ln.Addr().String(), "version", buildVersion(), "go", runtime.Version())
	return serve(ctx, newHTTPServer(handler, logger), ln, logger)
}

func parseConfig(args []string, getenv func(string) string, output io.Writer) (config, error) {
	flags := flag.NewFlagSet("photobrick", flag.ContinueOnError)
	flags.SetOutput(output)
	flags.Usage = func() {
		fmt.Fprint(output, "Usage: photobrick [flags]\n\nServes the PhotoBrick web app embedded in this binary.\n\nFlags:\n")
		flags.PrintDefaults()
	}

	addr := getenv("PHOTOBRICK_ADDR")
	if addr == "" {
		addr = defaultAddr
	}
	var cfg config
	flags.StringVar(&cfg.addr, "addr", addr, "listen `address` as host:port (env PHOTOBRICK_ADDR)")
	flags.BoolVar(&cfg.showVersion, "version", false, "print the version and exit")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return cfg, err
		}
		return cfg, usageError{err}
	}
	if flags.NArg() > 0 {
		err := fmt.Errorf("unexpected argument %q", flags.Arg(0))
		fmt.Fprintln(output, err)
		flags.Usage()
		return cfg, usageError{err}
	}
	return cfg, nil
}

// buildVersion prefers the -ldflags version and falls back to the module version that the go
// command stamps from VCS, so `go build` and `go install` binaries still identify themselves.
func buildVersion() string {
	if version != "dev" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return version
}

func newHTTPServer(handler http.Handler, logger *slog.Logger) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
}

// serve runs srv on ln until ctx is done, then shuts down gracefully: it stops accepting
// connections and waits up to shutdownTimeout for in-flight requests.
func serve(ctx context.Context, srv *http.Server, ln net.Listener, logger *slog.Logger) error {
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		return err // Serve returns only on failure while nothing has called Shutdown
	case <-ctx.Done():
	}

	logger.Info("shutting down", "timeout", shutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		_ = srv.Close()
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	logger.Info("stopped")
	return nil
}
