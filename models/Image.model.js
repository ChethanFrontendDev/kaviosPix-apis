const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    imageId: {
      type: String, // UUID
      required: true,
      unique: true,
    },

    albumId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Album",
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    tags: {
      type: [String],
      default: [],
    },

    person: {
      type: String,
      default: "",
    },

    isFavorite: {
      type: Boolean,
      default: false,
    },

    comments: [
      {
        text: {
          type: String,
          required: true,
        },
        commentedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        commentedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    size: {
      type: Number, // bytes
      required: true,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Image", imageSchema);
