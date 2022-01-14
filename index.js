const app = require(`./app`);
const PORT = process.env.PORT || 5000;
app.listen(PORT, (err) => {
    if (err) {
        return console.log(err.message);
    }
    console.log(`server started: %s`,PORT);
});
