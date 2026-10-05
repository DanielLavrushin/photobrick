// Package webui embeds the production build of the web app. Vite writes it to dist/ (see
// apps/web/vite.config.ts), so building the Go binary after `make web` bakes the UI into it.
package webui

import (
	"embed"
	"io/fs"
)

// The all: prefix keeps this compiling in a fresh clone, where dist/ holds only .gitkeep (a pattern
// that matches no embeddable file is a build error), and keeps files Vite names with a leading
// underscore.
//
//go:embed all:dist
var dist embed.FS

// FS returns the embedded build with index.html at its root. The build may be missing (dist/ holds
// only .gitkeep); callers check for index.html.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		// fs.Sub fails only for an invalid path name, and "dist" is valid.
		panic(err)
	}
	return sub
}
