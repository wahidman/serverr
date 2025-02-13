require('dotenv').config();
const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const cors = require('cors');
const bodyParser = require('body-parser');
const midtransClient = require('midtrans-client');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(bodyParser.json());

// Koneksi ke PostgreSQL
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    dialect: 'postgres',
    port: process.env.DB_PORT,
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false // Untuk menghindari error SSL
        }
    }
});

// Definisi Model Order
const Order = sequelize.define('Order', {
    id: {
        type: DataTypes.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    whatsapp: {
        type: DataTypes.STRING,
        allowNull: false
    },
    location: {
        type: DataTypes.STRING,
        allowNull: false
    },
    date: {
        type: DataTypes.STRING,
        allowNull: false
    },
    time: {
        type: DataTypes.STRING,
        allowNull: false
    },
    package: {
        type: DataTypes.STRING,
        allowNull: false
    },
    dpAmount: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: "PENDING"
    },
    orderId: {
        type: DataTypes.STRING,
        unique: true
    }
});

// Sinkronisasi Model
sequelize.sync()
    .then(() => console.log("Database & Tables Created!"))
    .catch(err => console.error("Database Error:", err));

// **Route untuk menerima form pemesanan**
// **Route untuk menerima form pemesanan**
app.post('/create-order', async (req, res) => {
    try {
        const { name, whatsapp, location, date, time, package, dpAmount } = req.body;

        // Cek apakah sudah ada pesanan pada tanggal dan waktu yang sama
        const existingOrder = await Order.findOne({
            where: {
                date: date,
                time: time
            }
        });

        if (existingOrder) {
            return res.status(400).json({ success: false, message: "Waktu tersebut sudah dipesan. Silakan pilih waktu lain." });
        }

        const orderId = "ORD-" + Date.now();

        const newOrder = await Order.create({
            name, whatsapp, location, date, time, package, dpAmount, status: "PENDING", orderId
        });

        res.json({ success: true, order_id: newOrder.orderId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan." });
    }
});

// **Route untuk membuat transaksi Midtrans**
app.post('/create-transaction', async (req, res) => {
    try {
        const { order_id, amount } = req.body;

        let snap = new midtransClient.Snap({
            isProduction: false,
            serverKey: process.env.MIDTRANS_SERVER_KEY
        });

        let parameter = {
            transaction_details: {
                order_id,
                gross_amount: amount
            },
            customer_details: {
                email: "customer@example.com",
                phone: "08123456789"
            }
        };

        let transaction = await snap.createTransaction(parameter);
        res.json({ success: true, transaction_token: transaction.token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Gagal membuat transaksi." });
    }
});

// **Route untuk menangani notifikasi dari Midtrans**
app.post('/midtrans-notification', async (req, res) => {
    try {
        let { order_id, transaction_status } = req.body;

        let status = "PENDING";
        if (transaction_status === "capture" || transaction_status === "settlement") {
            status = "PAID";
        } else if (transaction_status === "cancel" || transaction_status === "expire") {
            status = "FAILED";
        }

        await Order.update({ status }, { where: { orderId: order_id } });

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Gagal memproses notifikasi." });
    }
});

app.post('/create-order', async (req, res) => {
    try {
        const { name, whatsapp, location, date, time, package, dpAmount } = req.body;

        const existingOrder = await Order.findOne({ where: { date, time } });

        if (existingOrder) {
            return res.status(400).json({ success: false, message: "Waktu tersebut sudah dipesan. Silakan pilih waktu lain." });
        }

        const orderId = "ORD-" + Date.now();

        const newOrder = await Order.create({ name, whatsapp, location, date, time, package, dpAmount, status: "PENDING", orderId });

        // Generate link WhatsApp untuk admin
        const adminPhone = "6282251892599"; // Ganti dengan nomor admin
        const message = encodeURIComponent(`🔔 *Pesanan Baru!*
        📌 Nama: ${name}
        📞 WhatsApp: ${whatsapp}
        📍 Lokasi: ${location}
        📅 Tanggal: ${date}
        ⏰ Waktu: ${time}
        📦 Paket: ${package}
        💵 DP: Rp${dpAmount}
        🆔 Order ID: ${orderId}`);

        const waLink = `https://wa.me/${adminPhone}?text=${message}`;

        res.json({ success: true, order_id: newOrder.orderId, wa_link: waLink });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan." });
    }
});

// Endpoint untuk mendapatkan daftar waktu yang masih tersedia
app.get('/available-times', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ success: false, message: "Tanggal harus diisi." });
        }

        // Semua slot waktu yang tersedia dalam satu hari
        const allTimes = [
            "10:00", "11:00", "12:00", "13:00",
            "14:00", "15:00", "16:00", "17:00"
        ];

        // Ambil daftar waktu yang sudah dipesan
        const bookedTimes = await Order.findAll({
            attributes: ['time'],
            where: { date }
        });

        // Konversi hasil query menjadi array waktu yang sudah dipesan
        const bookedTimeList = bookedTimes.map(order => order.time);

        // Filter waktu yang masih tersedia
        const availableTimes = allTimes.filter(time => !bookedTimeList.includes(time));

        res.json({ success: true, availableTimes });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Gagal mengambil waktu tersedia." });
    }
});


// **Route untuk mendapatkan semua order (Dashboard Admin)**
app.get('/orders', async (req, res) => {
    try {
        const orders = await Order.findAll();
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Gagal mengambil data pesanan." });
    }
});

// Jalankan server
app.listen(PORT, () => {
    console.log("Server berjalan di http://localhost:${PORT}");
});
