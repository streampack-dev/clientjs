default:
    @just --list

# Run the tests (node:test, with jsdom for a DOM).
test:
    npm test

# Only files the tests load are counted. The target is 70% of lines, reported, not enforced.
# Run the tests and report coverage (Node's own)
coverage:
    npm run coverage

# Bumps package.json's version (patch, minor or major; an X.Y.Z-SNAPSHOT releases as X.Y.Z),
# points the README's install line at it, commits, tags vX.Y.Z, pushes main and the tag together,
# and publishes to Nexus. Front ends move to it with their own update.
# Release: bump, commit, tag, push and publish
release level="patch": _on-main
    #!/usr/bin/env bash
    set -euo pipefail
    level="{{level}}"
    files=(package.json README.md)
    # npm version writes the version into the lockfile too: commit it with the rest, and restore it
    # if the release fails, or the release leaves it changed and the next one refuses to start.
    if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then files+=(package-lock.json); fi
    case "$level" in
      patch|minor|major) ;;
      *) echo "release level must be one of: patch, minor, major" >&2; exit 1 ;;
    esac

    if [[ -n "$(git status --porcelain)" ]]; then
      echo "The working tree has uncommitted changes (a failed release?). Commit or restore them first." >&2
      exit 1
    fi
    git fetch -q --tags origin

    current="$(node -p "require('./package.json').version")"
    if [[ "$current" == *-SNAPSHOT ]]; then
      next="${current%-SNAPSHOT}"
    else
      IFS=. read -r major minor patch <<<"$current"
      if [[ -z "${major:-}" || -z "${minor:-}" || -z "${patch:-}" ]]; then
        printf 'current version is not semantic: <%s>\n' "$current" >&2
        exit 1
      fi
      case "$level" in
        patch) next="${major}.${minor}.$((patch + 1))" ;;
        minor) next="${major}.$((minor + 1)).0" ;;
        major) next="$((major + 1)).0.0" ;;
      esac
    fi
    if git rev-parse -q --verify "refs/tags/v$next" >/dev/null; then
      echo "v$next is already tagged." >&2
      exit 1
    fi

    npm test >/dev/null

    echo "Releasing $current -> $next"
    trap 'status=$?; if [[ $status -ne 0 && -z "${committed:-}" ]]; then git checkout -- "${files[@]}"; echo "Release failed; package.json restored to $current." >&2; fi' EXIT
    npm version "$next" --no-git-tag-version >/dev/null
    perl -0pi -e 's#("@streampack-dev/clientjs": "\^)[0-9]+\.[0-9]+\.[0-9]+#${1}'"$next"'#g' README.md
    git commit -q -m "updating release version" -- "${files[@]}"
    committed=1
    git tag -a "v$next" -m "clientjs $next"
    if ! git push -q --atomic origin main "v$next"; then
      echo "Push failed; main has the release commit and v$next locally. Push both with: git push --atomic origin main v$next" >&2
      exit 1
    fi
    echo "Released $next: pushed main and v$next."
    just publish "$next"

# Releases come from main, up to date with origin's: never from a feature branch.
_on-main:
    #!/usr/bin/env bash
    set -euo pipefail
    branch="$(git branch --show-current)"
    if [[ "$branch" != "main" ]]; then
      echo "Release from main, not ${branch:-a detached HEAD}." >&2
      exit 1
    fi
    git fetch -q origin main
    if [[ -n "$(git rev-list HEAD..origin/main)" ]]; then
      echo "main is behind origin/main. Pull first." >&2
      exit 1
    fi

# The whole release, as in the other projects. Here just release already commits, tags, pushes and
# publishes, so this is the same thing under the name the others use.
full-release level="patch":
    just release {{level}}

# Publishes from a clean export of the tag, so front ends can depend on
# "@streampack-dev/clientjs": "^X.Y.Z" through npm-group. just release runs this; run it by hand to
# retry a publish that failed. Credentials: NEXUS_USERNAME/NEXUS_PASSWORD, else
# DOCKER_USERNAME/DOCKER_PASSWORD, else the Maven server nexus-streampack in ~/.m2/settings.xml.
# Publish a tagged release to Nexus's npm-hosted
publish version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="{{version}}"
    version="${version#v}"
    registry="https://nexus.streampack.dev/repository/npm-hosted/"

    username="${NEXUS_USERNAME:-${DOCKER_USERNAME:-}}"
    password="${NEXUS_PASSWORD:-${DOCKER_PASSWORD:-}}"
    if [[ -z "$username" || -z "$password" ]]; then
      settings="${MAVEN_SETTINGS:-$HOME/.m2/settings.xml}"
      server_id="${MAVEN_NEXUS_SERVER_ID:-nexus-streampack}"
      if [[ ! -f "$settings" ]] || ! command -v xmllint >/dev/null 2>&1; then
        echo "Set NEXUS_USERNAME and NEXUS_PASSWORD (no $settings, or no xmllint to read it)." >&2
        exit 1
      fi
      field() { xmllint --xpath "string(/*[local-name()='settings']/*[local-name()='servers']/*[local-name()='server'][*[local-name()='id']='$server_id']/*[local-name()='$1'])" "$settings"; }
      username="$(field username)"
      password="$(field password)"
      if [[ -z "$username" || -z "$password" || "$password" == \{* ]]; then
        echo "No usable credentials for Maven server '$server_id' in $settings; set NEXUS_USERNAME and NEXUS_PASSWORD." >&2
        exit 1
      fi
    fi

    git fetch -q --tags origin
    if ! git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
      echo "v$version isn't tagged." >&2
      exit 1
    fi
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    mkdir "$work/package"
    git archive "v$version" | tar -x -C "$work/package"
    # The credentials live outside the package, so they can't end up in it.
    auth="$(printf '%s:%s' "$username" "$password" | base64 | tr -d '\n')"
    printf '//nexus.streampack.dev/repository/npm-hosted/:_auth=%s\n' "$auth" > "$work/npmrc"
    (cd "$work/package" && npm publish --registry "$registry" --userconfig "$work/npmrc")
    echo "Published @streampack-dev/clientjs@$version to $registry"
