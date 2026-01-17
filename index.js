const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { initializeDatabase } = require("./db/db.connect");
const { setSecureCookie } = require("./services");
const User = require("./models/User.model");
const Album = require("./models/Album.model");
const Image = require("./models/Image.model");
const { verifyJWT } = require("./middleware/verifyJWT");
const cloudinary = require("cloudinary");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PORT = process.env.PORT || 4000;

const app = express();

// app.set("trust proxy", 1);

app.use(
  cors({
    credentials: true,
    origin: ["https://kavios-pix-ui.vercel.app", "http://localhost:3000"],
  })
);
app.use(express.json());
app.use(cookieParser());

initializeDatabase();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer setup
const upload = multer({
  storage: multer.diskStorage({}),
  limits: {
    fileSize: 5 * 1024 * 1024, //  5MB max limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExt.includes(ext)) {
      return cb(
        new Error("Only image file types are allowed (jpg, png, gif, webp)")
      );
    }
    cb(null, true);
  },
});

app.get("/", (req, res) => {
  res.send(`<h1>Welcome to Google OAuth</h1>`);
});

app.get("/auth/google", (req, res) => {
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=https://kavios-pix-apis.vercel.app/auth/google/callback&response_type=code&scope=openid%20email%20profile&access_type=offline&prompt=consent`;

  res.redirect(googleAuthUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code");

  try {
    // 1. Exchange code for Google access token
    const tokenResponse = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `https://kavios-pix-apis.vercel.app/auth/google/callback`,
      }
    );

    const googleAccessToken = tokenResponse.data.access_token;

    // 2. Fetch Google user info ONCE
    const googleUserRes = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
        },
      }
    );

    const { email, name, picture } = googleUserRes.data;

    // 3. Save / update user in DB
    let user = await User.findOne({ email });

    if (user) {
      user.name = name;
      user.picture = picture;
      user.provider = "google";

      await user.save();
    } else {
      user = await User.create({
        email,
        name,
        picture,
        provider: "google",
      });
    }

    // 4. Create JWT payload
    const payload = {
      userId: user._id,
    };

    // 5. Sign JWT
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    // 6. Store JWT in HTTP-only cookie
    setSecureCookie(res, token);

    // 7. Redirect to frontend
    res.redirect(`${process.env.FRONTEND_URL}/v2/profile/google`);
  } catch (err) {
    // console.error(err);
    console.error("OAuth error:", err.response?.data || err);
    return res.status(500).json({
      error: "Google OAuth failed",
      details: err.response?.data || err.message,
    });
    // res.status(500).send("Google OAuth failed");
  }
});

app.get("/user/profile", verifyJWT, async (req, res) => {
  const user = await User.findById(req.user.userId).select(
    "email name picture provider"
  );

  res.json({ user });
});

app.post("/auth/logout", (req, res) => {
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });

  res.status(200).json({ message: "Logged out" });
});

// Create Album
app.post("/albums", verifyJWT, async (req, res) => {
  try {
    const saveNewAlbum = new Album(req.body);
    const savedAlbum = await saveNewAlbum.save();

    return res
      .status(201)
      .json({ message: "Album created successfully.", album: savedAlbum });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ error: `${field} already exists` });
    }

    if (error.name === "ValidationError") {
      const field = Object.keys(error.errors)[0];
      const message = error.errors[field].message;

      return res.status(400).json({
        error: `Invalid Input: '${field}' is required.`,
        details: message,
      });
    }

    res.status(500).json({ error: "Failed to add album." });
  }
});

// Update Album Description
app.put("/albums/:albumId", verifyJWT, async (req, res) => {
  const { albumId } = req.params;
  const { description } = req.body;

  try {
    const updateAlbum = await Album.findByIdAndUpdate(
      albumId,
      { description },
      {
        new: true,
      }
    );

    if (!updateAlbum) {
      return res.status(404).json({ error: "Album not found." });
    }

    return res.json({ message: "Description updated.", album: updateAlbum });
  } catch (error) {
    res.status(500).json({ error: "Failed to update album." });
  }
});

// Add Users to Album
app.post("/albums/:albumId/share", verifyJWT, async (req, res) => {
  const { albumId } = req.params;
  const { emails } = req.body;

  // Validate payload
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({
      error: "emails must be a non-empty array",
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = emails.filter((email) => !emailRegex.test(email));

  if (invalidEmails.length > 0) {
    return res.status(400).json({
      error: "Invalid email(s) provided",
      invalidEmails,
    });
  }

  try {
    const album = await Album.findById(albumId);

    if (!album) {
      return res.status(404).json({
        error: "Album not found",
      });
    }

    // Ensure users exist
    const users = await User.find({
      email: { $in: emails },
    }).select("email");

    const existingEmails = users.map((u) => u.email);
    const missingEmails = emails.filter(
      (email) => !existingEmails.includes(email)
    );

    if (missingEmails.length > 0) {
      return res.status(400).json({
        error: "Some users do not exist",
        missingEmails,
      });
    }

    // Prevent duplicates
    const newEmails = emails.filter(
      (email) => !album.sharedUsers.includes(email)
    );

    if (newEmails.length === 0) {
      return res.status(400).json({
        error: "All users are already shared with this album",
      });
    }

    album.sharedUsers.push(...newEmails);
    await album.save();

    return res.json({
      message: "Album shared successfully",
      sharedUsers: album.sharedUsers,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to share album",
    });
  }
});

// Delete Album and all its images.
app.delete("/albums/:albumId", verifyJWT, async (req, res) => {
  const { albumId } = req.params;

  try {
    const album = await Album.findByIdAndDelete(albumId);

    if (!album) {
      return res.status(404).json({ error: "Album not found." });
    }

    //  Delete all images linked to this album
    await Image.deleteMany({ albumId });

    return res.status(200).json({
      message: "Album and all associated images deleted successfully.",
      album: album,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete album." });
  }
});

// Get All Albums
app.get("/albums", verifyJWT, async (req, res) => {
  try {
    const readAlbums = await Album.find();

    return res.status(200).json(readAlbums);
  } catch (error) {
    return res.status(500).json({ error: "Failed to get albums." });
  }
});

// Get All Users
app.get("/users", verifyJWT, async (req, res) => {
  try {
    const readUsers = await User.find();

    return res.status(200).json(readUsers);
  } catch (error) {
    return res.status(500).json({ error: "Failed to get users." });
  }
});

// Upload Image
app.post(
  "/albums/:albumId/images",
  verifyJWT,
  upload.single("file"),
  async (req, res) => {
    try {
      const { albumId } = req.params;
      const { tags, person, isFavorite } = req.body;
      const file = req.file;

      //  Validate album exists
      const album = await Album.findById(albumId);
      if (!album) {
        return res.status(404).json({ message: "Album not found" });
      }

      //  Validate file
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      //  Get file metadata
      const fileStats = fs.statSync(file.path);

      //  Upload to Cloudinary
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "albums",
        resource_type: "image",
      });

      //  Parse tags safely
      let parsedTags = [];
      if (tags) {
        parsedTags = Array.isArray(tags) ? tags : JSON.parse(tags);
      }

      //  Save metadata to MongoDB
      const image = await Image.create({
        albumId,
        imageUrl: result.secure_url,
        name: file.originalname,
        size: fileStats.size,
        tags: parsedTags,
        person: person || "",
        isFavorite: isFavorite === "true",
        uploadedAt: new Date(),
      });

      res.status(201).json({
        message: "Image uploaded successfully",
        data: image,
      });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }
);

// Star Favorite Image
app.put(
  "/albums/:albumId/images/:imageId/favorite",
  verifyJWT,
  async (req, res) => {
    try {
      const { albumId, imageId } = req.params;

      const image = await Image.findOne({ _id: imageId, albumId });

      if (!image) {
        return res.status(404).json({
          message: "Image not found in this album",
        });
      }

      image.isFavorite = !image.isFavorite;
      await image.save();

      res.status(200).json({
        message: "Favorite status updated",
        isFavorite: image.isFavorite,
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Add Comments to Image
app.post(
  "/albums/:albumId/images/:imageId/comments",
  verifyJWT,
  async (req, res) => {
    try {
      const { albumId, imageId } = req.params;
      const { comment } = req.body;

      if (!comment || !comment.trim()) {
        return res.status(400).json({
          message: "Comment is required",
        });
      }

      const image = await Image.findOneAndUpdate(
        { _id: imageId, albumId },
        { $push: { comments: comment } },
        { new: true }
      );

      if (!image) {
        return res.status(404).json({
          message: "Image not found in this album",
        });
      }

      res.status(201).json({
        message: "Comment added successfully",
        comments: image.comments,
      });
    } catch (error) {
      res.status(400).json({
        message: error.message,
      });
    }
  }
);

// Delete Image
app.delete("/albums/:albumId/images/:imageId", verifyJWT, async (req, res) => {
  try {
    const { albumId, imageId } = req.params;

    //  Find image and ensure it belongs to album
    const image = await Image.findOne({ _id: imageId, albumId });

    if (!image) {
      return res.status(404).json({
        message: "Image not found in this album",
      });
    }

    //  Delete from MongoDB
    await Image.deleteOne({ _id: imageId });

    res.status(200).json({
      message: "Image deleted successfully",
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
});

// Get All Images in an Album
app.get("/albums/:albumId/images", verifyJWT, async (req, res) => {
  try {
    const { albumId } = req.params;

    const readAllImages = await Image.find({ albumId });

    res.status(200).json(readAllImages);
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
});

// Get Favorite Images in an Album
app.get("/albums/:albumId/images/favorites", verifyJWT, async (req, res) => {
  try {
    const { albumId } = req.params;

    const readFavoriteImages = await Image.find({
      albumId,
      isFavorite: true,
    });

    res.status(200).json(readFavoriteImages);
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
});

// Get Images by Tags
app.get("/albums/:albumId/images/by-tag", verifyJWT, async (req, res) => {
  try {
    const { albumId } = req.params;
    const { tags } = req.query;

    const filter = { albumId };

    // If tags query is provided, filter by tag
    if (tags) {
      filter.tags = { $regex: tags, $options: "i" }; // matches images containing this tag
    }

    const readImages = await Image.find(filter);

    res.status(200).json(readImages);
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
