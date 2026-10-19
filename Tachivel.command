#!/bin/zsh
# Tachivel launcher.
#   tachivel         open https://tachivel.netlify.app in Safari, full screen (reuses an open Tachivel tab)
#   tachivel local   serve this folder on localhost:47613 instead (works offline)
#   tachivel stop    stop the local server
# Voice, speed, theme, text size and your place are saved by the site itself, per address.
cd "${0:A:h}"   # :A resolves the symlink, so this works from anywhere
SITE="https://tachivel.netlify.app/"
PORT=47613
LOCAL="http://localhost:$PORT/"

open_fullscreen() {
  local url="$1"
  osascript - "$url" <<'APPLESCRIPT' 2>/dev/null
on run argv
  set target to item 1 of argv
  tell application "Safari"
    activate
    set found to false
    repeat with w in windows
      try
        repeat with t in tabs of w
          if URL of t starts with target then
            set current tab of w to t
            set index of w to 1
            set found to true
            exit repeat
          end if
        end repeat
      end try
      if found then exit repeat
    end repeat
    if not found then make new document with properties {URL:target}
  end tell
  delay 0.6
  tell application "System Events" to tell process "Safari"
    set value of attribute "AXFullScreen" of front window to true
  end tell
end run
APPLESCRIPT
  if [[ $? -ne 0 ]]; then
    open -a Safari "$url"
    echo "Opened Tachivel, but couldn't switch to full screen."
    echo "Allow your terminal in System Settings → Privacy & Security → Accessibility, then run tachivel again."
    return
  fi
  echo "Tachivel is open in Safari ($url)."
}

case "$1" in
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
    open_fullscreen "$LOCAL"
    echo "Run 'tachivel stop' to shut the local server down."
    ;;
  *)
    open_fullscreen "$SITE"
    ;;
esac
