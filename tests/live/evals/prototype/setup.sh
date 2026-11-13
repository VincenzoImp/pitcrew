#!/bin/bash
set -e
printf "# greet\nA tiny CLI.\n" > README.md
printf "console.log(\"hello\");\n" > greet.js
git add -A && git commit -qm init
