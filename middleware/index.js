// function verifyAccessToken(req, res, next) {
//   const token = req.cookies.access_token;

//   if (!token) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }

//   req.accessToken = token; 
//   next();
// }

// module.exports = { verifyAccessToken };
