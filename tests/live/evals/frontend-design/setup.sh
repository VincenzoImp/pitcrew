#!/bin/bash
set -e
cat > signup.html <<'H'
<!doctype html>
<html><body>
<div style="color:#aaa;background:#eee">
<div>Sign up</div>
<input id="email" placeholder="email">
<input id="password" type="password" placeholder="password">
<div onclick="send()" style="background:#ccc">OK</div>
</div>
<script>function send(){ alert("sent"); }</script>
</body></html>
H
git add -A && git commit -qm init
