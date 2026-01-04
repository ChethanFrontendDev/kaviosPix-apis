const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  name: String,
  picture: String,
  provider: String,
});

const User = mongoose.model("User", UserSchema);

module.exports = User;
