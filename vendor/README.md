# Vendored packages

> **Design decision:** every icon in the app comes from the Hugeicons Pro
> **stroke-rounded** set. Do not use bulk/solid variants or other icon
> libraries (lucide, Iconify, inline SVG) in new code.

## @hugeicons-pro/core-stroke-rounded

Hugeicons Pro icons ship from a private npm registry (npm.hugeicons.com) that
needs an active subscription token to download. To keep CI and fresh installs
from needing a token, the package tarball is kept in this folder and
`package.json` references it through `file:vendor/...`.

### Updating to a new version

With an active Hugeicons Pro token configured in `~/.npmrc`:

```bash
cd vendor
npm pack @hugeicons-pro/core-stroke-rounded
# Point the file: reference in package.json at the new .tgz, delete the old one
cd .. && npm install
```

Get a token at: https://hugeicons.com/account/tokens
Lines to add to `~/.npmrc`:

```
@hugeicons-pro:registry=https://npm.hugeicons.com/
//npm.hugeicons.com/:_authToken=<token>
```
