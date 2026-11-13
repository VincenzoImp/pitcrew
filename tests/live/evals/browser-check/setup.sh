#!/bin/bash
set -e
cat > index.html <<'H'
<!doctype html>
<html><body><ul id="list"></ul>
<script>
  const items = ["one", "two"];
  renderLst(items);
  function renderList(xs) { document.getElementById("list").innerHTML = xs.map((x) => `<li>${x}</li>`).join(""); }
</script></body></html>
H
git add -A && git commit -qm init
