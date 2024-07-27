const express = require("express");
const router = express.Router();

// Version 1 Routes here
const userRoute = require("./user.route");

router.use("/user", userRoute);

module.exports = router;
