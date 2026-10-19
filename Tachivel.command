#!/bin/zsh
# Start Tachivel: serves this folder on localhost and opens it in Safari.
# Double-click it in Finder, or run `tachivel` (symlinked into ~/.local/bin). `tachivel stop` shuts the server down.
cd "${0:A:h}"   # :A resolves the symlink, so this works from anywhere
PORT=47613
URL="http://localhost:$PORT/"

if [[ "$1" == "stop" ]]; then
  PID=$(lsof -tiTCP:$PORT -sTCP:LISTEN)
  if [[ -n "$PID" ]]; then kill $PID && echo "Tachivel stopped."; else echo "Tachivel isn't running."; fi
  exit 0
fi

if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  if ! curl -s "$URL" | grep -q "<title>Tachivel</title>"; then
    echo "Port $PORT is taken by another app. Change PORT in ${0:A} and try again."; exit 1
  fi
else
  nohup python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &!
  for i in {1..20}; do curl -s -o /dev/null "$URL" && break; sleep 0.1; done
fi
open -a Safari "$URL"
echo "Tachivel is open in Safari ($URL). Run 'tachivel stop' to shut the server down."
