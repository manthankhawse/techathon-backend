const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  city: { type: String },
  dob: { type: Date },
  password: { type: String, required: true },
});

// Check if the model already exists
const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
