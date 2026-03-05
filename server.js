const express = require("express")
const axios = require("axios")

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const TOKEN = "EAANeV5tPgr0BQZB7fVcJ2xNuMtBBsWkYyjXDswtEXFVpB2NvM8U2jHde3y64sZCvTahIH3n8OXJzSlSysmzj5CBX5jhfw6ISp6GOcH5AtMXwBA1TFC1USLfEiY7r91PhUZBDEOZCwnXa5ehZCZBfpfXnZAeYnXOevTZBrHoiXxVYWlrhRvdDEhyQ294sE1wsl6LezZAiKKAscQw9d5hDWGfnDbHFE9EkI3qUmZBYQTbuRwIeCKJvttMRFJixdID1eMJZBZCX1wG7gpj6tyT2llZC1fDV4z4yT4DxejyZCtzT7I0QZDZD"
const PHONE_ID = "937736869432295"

app.post('/webhook-c807', (req, res) => {

  console.log("Webhook completo:", req.body);

  let data;

  try {
    const key = Object.keys(req.body)[0]; // toma la clave rara
    data = JSON.parse(key); // la convierte a JSON
  } catch (error) {
    console.log("Error parseando webhook:", error);
    return res.sendStatus(200);
  }

  const guia = data.guia;
  const estatus = data.estatus;

  console.log("Guia:", guia);
  console.log("Estatus:", estatus);

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Servidor escuchando en puerto 3000")
})