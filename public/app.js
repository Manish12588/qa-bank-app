async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

function showError(elId, message) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.className = "error";
}

function showSuccess(elId, message) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.className = "success";
}
