package httpserver

import "testing"

func TestAcceptsHTML(t *testing.T) {
	tests := []struct {
		values []string
		want   bool
	}{
		{nil, true},
		{[]string{""}, true},
		{[]string{"text/html"}, true},
		{[]string{"TEXT/HTML"}, true},
		{[]string{"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}, true},
		{[]string{"*/*"}, true},
		{[]string{"text/*"}, true},
		{[]string{"text/html;level=1;q=0.5"}, true},
		{[]string{"application/json"}, false},
		{[]string{"image/avif,image/webp,*/*;q=0"}, false},
		{[]string{"text/html;q=0"}, false},
		{[]string{"text/html;q=0, */*"}, false}, // the more specific range wins
		{[]string{"text/*;q=0, */*"}, false},
		{[]string{"*/*;q=0, text/html;q=0.1"}, true},
		{[]string{"application/json", "text/html"}, true}, // several header lines
		{[]string{"text/plain, text/css"}, false},
		{[]string{"text/html;q=bogus"}, true}, // a malformed weight counts as 1
	}
	for _, tt := range tests {
		if got := acceptsHTML(tt.values); got != tt.want {
			t.Errorf("acceptsHTML(%q) = %v, want %v", tt.values, got, tt.want)
		}
	}
}

func TestEncodingWeight(t *testing.T) {
	tests := []struct {
		header, coding string
		want           float64
	}{
		{"", "br", 0},
		{"br", "br", 1},
		{"gzip, br;q=0.4", "br", 0.4},
		{"gzip ; q=0.3", "gzip", 0.3},
		{"x-gzip", "gzip", 1},
		{"x-gzip", "br", 0},
		{"*;q=0.2", "br", 0.2},
		{"*;q=0.2, br;q=0.9", "br", 0.9},
		{"*, br;q=0", "br", 0},
		{"br;q=7", "br", 1},
		{"br;q=-1", "br", 0},
		{"br;q=NaN", "br", 1},
	}
	for _, tt := range tests {
		if got := encodingWeight([]string{tt.header}, tt.coding); got != tt.want {
			t.Errorf("encodingWeight(%q, %q) = %v, want %v", tt.header, tt.coding, got, tt.want)
		}
	}
}

func TestChooseEncodingNoCandidates(t *testing.T) {
	if _, ok := chooseEncoding([]string{"br, gzip"}, nil); ok {
		t.Error("chose an encoding from an empty list")
	}
}

func BenchmarkAcceptsHTML(b *testing.B) {
	values := []string{"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"}
	b.ReportAllocs()
	for b.Loop() {
		acceptsHTML(values)
	}
}
