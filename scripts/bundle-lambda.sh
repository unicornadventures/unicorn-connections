#!/usr/bin/env bash
#
# Bundles the API into self-contained Lambda artifacts under infra/build/.
#
# Why bundle at all: this is an npm-workspaces monorepo, so `apps/api/node_modules`
# does not exist — every dependency is hoisted to the 389 MB repo root, and
# `@classyear/shared-types` is a symlink with a genuine runtime import
# (`common/avatar-colors.js` re-exports from it). Zipping `apps/api` would ship
# a function that cannot resolve anything. Bundling flattens both problems into
# one file per handler, and drops ~380 MB of devDependencies on the way.
#
#   ./scripts/bundle-lambda.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_ROOT/infra/build"

# npm's allow-scripts blocks esbuild's postinstall, which is what would normally
# put `esbuild` on PATH. The platform package ships the binary directly.
ESBUILD="$REPO_ROOT/node_modules/@esbuild/darwin-arm64/bin/esbuild"
[ -x "$ESBUILD" ] || ESBUILD="$(command -v esbuild)"
[ -x "$ESBUILD" ] || { echo "esbuild not found" >&2; exit 1; }

echo "==> Compiling TypeScript"
npm --prefix "$REPO_ROOT" run build --silent >/dev/null

rm -rf "$OUT" && mkdir -p "$OUT/api" "$OUT/workers"

bundle() {
  local entry="$1" outfile="$2"
  "$ESBUILD" "$entry" \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --outfile="$outfile" \
    --log-level=warning \
    `# Nest resolves these lazily and only if the corresponding feature is used.` \
    `# None is, and bundling them would pull in transports this app has no need for.` \
    --external:@nestjs/microservices \
    --external:@nestjs/websockets \
    --external:@nestjs/platform-socket.io \
    --external:class-transformer/storage \
    --external:cache-manager \
    `# Optional native accelerator for pg; the pure-JS path is what we use.` \
    --external:pg-native \
    `# An ESM bundle has no require(), but the CJS dependencies inside it still` \
    `# call one — including dynamic requires of node builtins, which esbuild's` \
    `# own shim refuses. createRequire gives them a real one.` \
    --banner:js="import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);"
}

echo "==> Bundling the API proxy"
bundle "$REPO_ROOT/apps/api/dist/lambda.js" "$OUT/api/index.mjs"

echo "==> Bundling the warmer and email worker"
bundle "$REPO_ROOT/apps/api/dist/lambda-workers.js" "$OUT/workers/index.mjs"

# Lambda decides CJS-vs-ESM from the file extension and the nearest package.json.
# `.mjs` is unambiguous on its own, but an explicit marker keeps it that way if
# anyone later renames the entry point.
for dir in api workers; do
  printf '{ "type": "module" }\n' > "$OUT/$dir/package.json"
done

echo
du -sh "$OUT"/api "$OUT"/workers | sed 's/^/    /'
echo "==> Artifacts in infra/build/"
