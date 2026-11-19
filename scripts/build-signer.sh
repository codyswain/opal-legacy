#!/bin/sh
# Builds the helper that signs Auto's sends with this Mac's Secure Enclave key
# (native/opal-signer) into build/native/opal-signer, with an ad-hoc signature.
# The packaged app carries it as an extra resource. Skipped where there is no swiftc.
set -eu
cd "$(dirname "$0")/.."
src=native/opal-signer/main.swift
out=build/native/opal-signer
if ! command -v swiftc >/dev/null 2>&1; then
  echo "build-signer: no swiftc, skipped; Opal will not be able to allow Auto's sends" >&2
  exit 0
fi
if [ -x "$out" ] && [ "$out" -nt "$src" ]; then
  exit 0
fi
mkdir -p build/native
swiftc -O -o "$out" "$src"
codesign --force --sign - "$out"
echo "build-signer: built $out"
