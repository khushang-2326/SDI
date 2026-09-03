async function test() {
  const res = await fetch("https://sdi-production-c505.up.railway.app/login");
  const html = await res.text();
  
  // Extract action ID
  const match = html.match(/name="\$ACTION_ID_([a-zA-Z0-9_]+)"/);
  console.log("Action ID match:", match ? match[1] : "not found");
  
  if (match) {
    const actionId = match[1];
    const formData = new FormData();
    formData.append(`$ACTION_ID_${actionId}`, "");
    formData.append("loginId", "admin");
    formData.append("password", "admin123");

    const postRes = await fetch("https://sdi-production-c505.up.railway.app/login", {
      method: "POST",
      headers: {
        "Next-Action": actionId,
        "Origin": "https://sdi-production-c505.up.railway.app"
      },
      body: formData
    });

    console.log("Status:", postRes.status);
    console.log("Headers:", Object.fromEntries(postRes.headers.entries()));
    const text = await postRes.text();
    console.log("Response text:\n", text);
  }
}

test().catch(console.error);
