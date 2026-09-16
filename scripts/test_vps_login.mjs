async function testLogin() {
  const BASE_URL = "https://sdi-production-c505.up.railway.app";
  console.log("Fetching login page from", BASE_URL);
  const res = await fetch(`${BASE_URL}/login`);
  const html = await res.text();
  console.log("Page fetched, length:", html.length);

  const match = html.match(/name="\$ACTION_ID_([a-zA-Z0-9_]+)"/);
  console.log("Action ID match:", match ? match[1] : "not found");

  if (!match) {
    console.error("Could not find action ID in HTML");
    return;
  }

  const actionId = match[1];
  const formData = new FormData();
  formData.append(`$ACTION_ID_${actionId}`, "");
  formData.append("loginId", "admin");
  formData.append("password", "admin123");

  console.log("Sending login POST with Next-Action and Origin...");
  const postRes = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Next-Action": actionId,
      "Origin": BASE_URL,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    },
    body: formData,
    redirect: "manual"
  });

  console.log("Login POST Status:", postRes.status);
  console.log("Headers:", Object.fromEntries(postRes.headers.entries()));
  console.log("getSetCookie():", postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : "no getSetCookie");
  const text = await postRes.text();
  console.log("Response text snippet:", text.slice(0, 500));
}

testLogin().catch(console.error);
