// prank-server.js

const express = require('express');
const bodyParser = require('body-parser');
const app = express();

// Middleware
app.use(bodyParser.json());

// Fake Money Transfer Endpoint
app.post('/fake-transfer', (req, res) => {
    const { amount, sender, receiver } = req.body;
    
    // Here you can add your logic for fake money transfers
    // This is just a simulation, no real transfers take place
    console.log(`Fake transfer of $${amount} from ${sender} to ${receiver} initiated.`);
    
    res.status(200).json({
        message: 'Fake transfer successful!',
        details: {
            amount,
            sender,
            receiver,
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
