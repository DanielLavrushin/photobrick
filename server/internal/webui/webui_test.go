package webui

import (
	"io/fs"
	"testing"
)

// The embedded content depends on whether `make web` ran, so this only checks that FS is rooted
// inside dist/ and never panics.
func TestFSIsRootedAtDist(t *testing.T) {
	info, err := fs.Stat(FS(), ".")
	if err != nil {
		t.Fatalf("stat root: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("root is not a directory")
	}
}
