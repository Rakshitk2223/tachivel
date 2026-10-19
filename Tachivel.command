#!/bin/zsh
# Tachivel launcher. Needs no special permissions: it only asks macOS to open a URL in Safari.
#   tachivel         open https://tachivel.netlify.app in Safari
#   tachivel local   serve this folder on localhost:47613 instead (works offline)
#   tachivel stop    stop the local server
# Voice, speed, theme, text size and your place are saved by the site itself, per address.
cd "${0:A:h}"   # :A resolves the symlink, so this works from anywhere
SITE="https://tachivel.netlify.app/"
PORT=47613
LOCAL="http://localhost:$PORT/"

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
    open -a Safari "$LOCAL"
    echo "Tachivel (local) is open in Safari. Run 'tachivel stop' to shut the server down."
    ;;
  *)
    open -a Safari "$SITE"
    echo "Tachivel is open in Safari."
    ;;
esac
