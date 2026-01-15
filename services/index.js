function setSecureCookie(res, token) {
  res.cookie("access_token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 60 * 60 * 1000,
    path: "/",
  });

  return res;
}

module.exports = { setSecureCookie };
