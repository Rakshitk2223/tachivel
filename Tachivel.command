#!/bin/zsh
# Tachivel launcher. Needs no special permissions.
#   tachivel                open https://tachivel.netlify.app in Safari
#   tachivel login          save your Tachivel passphrase in the macOS Keychain (once)
#   tachivel push [file]    upload an EPUB to your library (defaults to the watched file)
#   tachivel watch <file>   upload that EPUB by itself every time it changes (your weekly build)
#   tachivel unwatch        stop watching
#   tachivel status         is the watcher loaded, and did the newest build go up? (exit 1 if not)
#   tachivel local          serve this folder on localhost:47613 instead (works offline)
#   tachivel stop           stop the local server
cd "${0:A:h}"   # :A resolves the symlink, so this works from anywhere
SITE="${TACHIVEL_SITE:-https://tachivel.netlify.app}"   # TACHIVEL_SITE lets `npm run dev` point here
PORT=47613
LOCAL="http://localhost:$PORT/"
CONF="$HOME/.config/tachivel"
AGENT="app.tachivel.watch"
PLIST="$HOME/Library/LaunchAgents/$AGENT.plist"
SELF="${0:A}"

# Every push leaves its outcome in $CONF/last-result, so `tachivel status` (or the book build) can tell a failure from silence.
failed() {
  echo "$(date '+%F %T') $*"
  mkdir -p "$CONF"; echo "$(date '+%F %T') FAILED: $*" > "$CONF/last-result"
  return 1
}

push_book() {
  local file="${1:-$(cat "$CONF/watch-file" 2>/dev/null)}"
  if [[ ! -f "$file" ]]; then failed "No EPUB found at: ${file:-(none given)}"; return 1; fi

  # The weekly build may still be writing the file: wait until its size stops changing.
  local before after
  before=$(stat -f %z "$file"); sleep 3; after=$(stat -f %z "$file")
  while [[ "$before" != "$after" ]]; do before=$after; sleep 3; after=$(stat -f %z "$file"); done

  # One push at a time (the watcher and the book build may both fire): the second waits, then finds it already sent.
  local lock="$CONF/push.lock" n=0
  mkdir -p "$CONF"
  find "$lock" -maxdepth 0 -mmin +10 -exec rmdir {} \; 2>/dev/null   # left behind by a push that died
  until mkdir "$lock" 2>/dev/null; do
    (( n++ > 300 )) && { failed "Another push has been running for 5 minutes."; return 1; }
    sleep 1
  done
  trap "rmdir '$lock'" EXIT

  local hash
  hash=$(shasum -a 256 "$file" | cut -d' ' -f1)
  if [[ "$hash" == "$(cat "$CONF/last-push" 2>/dev/null)" && "$2" != "--force" ]]; then
    echo "$(date '+%F %T') Already in your library: $(basename "$file")"; return 0
  fi

  local pass
  pass="${TACHIVEL_PASSPHRASE:-$(security find-generic-password -s tachivel -a passphrase -w 2>/dev/null)}"
  if [[ -z "$pass" ]]; then failed "No passphrase saved yet. Run: tachivel login"; return 1; fi

  local tmp; tmp=$(mktemp -d); trap "rm -rf '$tmp'; rmdir '$lock'" EXIT   # holds the session cookie and the parts; deleted at the end
  local jar="$tmp/cookies"
  # The passphrase goes to curl on stdin, never on the command line where other processes could see it.
  pass=${pass//\\/\\\\}; pass=${pass//\"/\\\"}
  if ! printf '{"passphrase":"%s"}' "$pass" | curl -sf -c "$jar" -H "content-type: application/json" --data-binary @- "$SITE/api/login" >/dev/null; then
    failed "Sign-in failed. Check your passphrase with: tachivel login"; return 1
  fi

  # Delta layout: each picture goes up once, named by its hash; everything else (the text, ~2 MB) goes up as a zip
  # "pack". Devices then fetch the pack plus only pictures they haven't seen. If any of it fails, the whole-file
  # parts below still carry the book, just slower.
  local pack="" media="" delta=1 entry h
  local -A known; local -a strip
  for h in ${(f)"$(curl -sf -b "$jar" "$SITE/api/book" | grep -oE '[0-9a-f]{64}')"}; do known[$h]=1; done
  if mkdir "$tmp/x" && unzip -qq "$file" -d "$tmp/x" && cp "$file" "$tmp/pack.zip"; then
    for entry in ${(f)"$(unzip -Z1 "$file")"}; do
      [[ "${entry:l}" == *.(jpg|jpeg|png|gif|webp|avif) && -f "$tmp/x/$entry" ]] || continue
      (( $(stat -f %z "$tmp/x/$entry") <= 4194304 )) || continue   # too big for one request: it stays in the pack
      h=$(shasum -a 256 "$tmp/x/$entry" | cut -d' ' -f1)
      if [[ -z "${known[$h]}" ]]; then
        curl -sf -b "$jar" -X PUT -H "content-type: application/octet-stream" --data-binary @"$tmp/x/$entry" "$SITE/api/book/files/$h" >/dev/null || { delta=; break; }
        known[$h]=1
      fi
      strip+=("$entry")
      entry=${entry//\\/\\\\}; entry=${entry//\"/\\\"}
      media+="${media:+,}\"$entry\":\"$h\""
    done
    (( ${#strip} )) && { zip -dq -nw "$tmp/pack.zip" -- "${strip[@]}" || delta=; }
    if [[ -n "$delta" ]]; then
      split -b 4194304 "$tmp/pack.zip" "$tmp/pack-"
      for p in "$tmp"/pack-*; do
        h=$(shasum -a 256 "$p" | cut -d' ' -f1)
        curl -sf -b "$jar" -X PUT -H "content-type: application/octet-stream" --data-binary @"$p" "$SITE/api/book/files/$h" >/dev/null || { delta=; break; }
        pack+="${pack:+,}\"$h\""
      done
    fi
  else delta=; fi
  [[ -z "$delta" ]] && echo "$(date '+%F %T') Couldn't send the quick-update files; sending the whole book only."

  split -b 4194304 "$file" "$tmp/part-"
  local parts=("$tmp"/part-*) upload="$(date +%s)-$(openssl rand -hex 3)" i=0
  for p in $parts; do
    if ! curl -sf -b "$jar" -X PUT -H "content-type: application/octet-stream" --data-binary @"$p" "$SITE/api/book/parts/$upload/$i" >/dev/null; then
      failed "Upload failed on part $((i + 1)) of ${#parts}."; return 1
    fi
    i=$((i + 1))
  done
  local name; name=$(basename "$file"); name=${name//\\/\\\\}; name=${name//\"/\\\"}
  local extra=""; [[ -n "$delta" ]] && extra=",\"pack\":[$pack],\"media\":{$media}"
  if ! printf '{"upload":"%s","parts":%d,"size":%d,"name":"%s","title":"%s"%s}' "$upload" ${#parts} "$(stat -f %z "$file")" "$name" "${name%.epub}" "$extra" \
      | curl -sf -b "$jar" -X PUT -H "content-type: application/json" --data-binary @- "$SITE/api/book" >/dev/null; then
    failed "Couldn't finish the upload."; return 1
  fi
  mkdir -p "$CONF"; echo "$hash" > "$CONF/last-push"
  local msg="Uploaded $(basename "$file") ($(( $(stat -f %z "$file") / 1024 / 1024 )) MB${delta:+, quick update})."
  echo "$(date '+%F %T') ok: $msg" > "$CONF/last-result"
  echo "$(date '+%F %T') $msg Your devices get it next time they open Tachivel."
}

case "$1" in
  login)
    echo "Enter your Tachivel passphrase (the same one you set in Netlify). It's stored in your macOS Keychain."
    security add-generic-password -U -s tachivel -a passphrase -w || exit 1
    echo "Saved."
    ;;
  push)
    push_book "$2" "$3"
    ;;
  watch)
    file="${2:A}"
    if [[ ! -f "$file" ]]; then echo "Give the EPUB to watch, e.g.: tachivel watch \"~/path/to/Book.epub\""; exit 1; fi
    mkdir -p "$CONF" "$HOME/Library/LaunchAgents"
    echo "$file" > "$CONF/watch-file"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AGENT</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$SELF</string><string>push</string></array>
  <key>WatchPaths</key><array><string>${file:h}</string></array>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/tachivel.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/tachivel.log</string>
</dict></plist>
PLISTEOF
    launchctl bootout "gui/$UID/$AGENT" 2>/dev/null
    launchctl bootstrap "gui/$UID" "$PLIST" && echo "Watching $file. Every new build uploads by itself (log: ~/Library/Logs/tachivel.log)."
    ;;
  status)
    # Exit 1 when the newest build isn't in the library or the watcher isn't loaded, so a build script can check.
    file=$(cat "$CONF/watch-file" 2>/dev/null); bad=
    if launchctl print "gui/$UID/$AGENT" >/dev/null 2>&1; then echo "Watcher: loaded"
    elif [[ -f "$PLIST" ]]; then echo "Watcher: NOT loaded. Fix: launchctl bootstrap gui/$UID \"$PLIST\""; bad=1
    else echo "Watcher: not set up. Fix: tachivel watch \"<file>\""; bad=1; fi
    echo "Last push: $(cat "$CONF/last-result" 2>/dev/null || echo none)"
    if [[ -f "$file" ]]; then
      if [[ "$(shasum -a 256 "$file" | cut -d' ' -f1)" == "$(cat "$CONF/last-push" 2>/dev/null)" ]]; then echo "Newest build: in your library"
      else echo "Newest build: NOT uploaded yet ($(date -r "$file" '+%F %T')). Fix: tachivel push"; bad=1; fi
    fi
    [[ -z "$bad" ]]
    ;;
  unwatch)
    launchctl bootout "gui/$UID/$AGENT" 2>/dev/null; rm -f "$PLIST" "$CONF/watch-file"
    echo "Stopped watching."
    ;;
  stop)
    PID=$(lsof -tiTCP:$PORT -sTCP:LISTEN)
    if [[ -n "$PID" ]]; then kill $PID && echo "Local Tachivel stopped."; else echo "Local Tachivel isn't running."; fi
    ;;
  local)
    if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
      if ! curl -s "$LOCAL" | grep -q "<title>Tachivel</title>"; then
        echo "Port $PORT is taken by another app. Change PORT in ${0:A} and try again."; exit 1
      fi
    else
      nohup python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &!
      for i in {1..20}; do curl -s -o /dev/null "$LOCAL" && break; sleep 0.1; done
    fi
    open -a Safari "$LOCAL"
    echo "Tachivel (local) is open in Safari. Run 'tachivel stop' to shut the server down."
    ;;
  *)
    open -a Safari "$SITE/"
    echo "Tachivel is open in Safari."
    ;;
esac
