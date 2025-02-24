const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const v1 = require("./routes/v1");

dotenv.config();
const app = express();

// Express middlewares
app.use(cors());

app.use("/api/v1", v1);

app.get("/", (req, res) => {
  return res.json({
    success: true,
    message: "Yes sirrr! Its working fineee!",
    announced_ip: process.env.ANNOUNCED_IP,
  });
});

module.exports = app;
