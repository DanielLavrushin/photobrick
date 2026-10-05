package httpserver

import (
	"math"
	"strconv"
	"strings"
)

// acceptsHTML reports whether a client sending these Accept field values accepts text/html
// (RFC 9110 §12.5.1). The most specific matching media range decides its weight, so
// "text/html;q=0, */*" refuses HTML. A request without an Accept field accepts anything.
func acceptsHTML(values []string) bool {
	seen := false
	best, weight := -1, 0.0 // specificity of the best matching range (2 text/html, 1 text/*, 0 */*) and its q
	for _, v := range values {
		for elem := range strings.SplitSeq(v, ",") {
			mediaRange, params, _ := strings.Cut(elem, ";")
			mediaRange = strings.TrimSpace(mediaRange)
			if mediaRange == "" {
				continue
			}
			seen = true
			spec := -1
			switch {
			case strings.EqualFold(mediaRange, "text/html"):
				spec = 2
			case strings.EqualFold(mediaRange, "text/*"):
				spec = 1
			case mediaRange == "*/*":
				spec = 0
			}
			if spec < 0 || spec < best {
				continue
			}
			if q := qvalue(params); spec > best {
				best, weight = spec, q
			} else {
				weight = max(weight, q)
			}
		}
	}
	return !seen || (best >= 0 && weight > 0)
}

// chooseEncoding picks the precompressed representation the client weights highest in its
// Accept-Encoding field values. Ties go to the earlier entry of reps, which is the server's
// preference order. It reports false when the client accepts none of them.
func chooseEncoding(values []string, reps []representation) (representation, bool) {
	best, bestQ := -1, 0.0
	for i := range reps {
		if q := encodingWeight(values, reps[i].encoding); q > bestQ {
			best, bestQ = i, q
		}
	}
	if best < 0 {
		return representation{}, false
	}
	return reps[best], true
}

// encodingWeight returns the q-value that Accept-Encoding field values give to coding: its own entry
// if listed, else the "*" entry, else 0 (RFC 9110 §12.5.3).
func encodingWeight(values []string, coding string) float64 {
	explicit, wildcard := -1.0, -1.0
	for _, v := range values {
		for elem := range strings.SplitSeq(v, ",") {
			name, params, _ := strings.Cut(elem, ";")
			name = strings.TrimSpace(name)
			switch {
			case strings.EqualFold(name, coding) || (coding == "gzip" && strings.EqualFold(name, "x-gzip")):
				explicit = max(explicit, qvalue(params))
			case name == "*":
				wildcard = max(wildcard, qvalue(params))
			}
		}
	}
	if explicit >= 0 {
		return explicit
	}
	return max(wildcard, 0)
}

// qvalue returns the q parameter from a ";"-separated parameter list. A missing or malformed weight
// counts as 1, the default.
func qvalue(params string) float64 {
	for p := range strings.SplitSeq(params, ";") {
		k, v, ok := strings.Cut(p, "=")
		if !ok || !strings.EqualFold(strings.TrimSpace(k), "q") {
			continue
		}
		q, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil || math.IsNaN(q) {
			return 1
		}
		return min(max(q, 0), 1)
	}
	return 1
}
