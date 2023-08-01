const express = require('express');
const { Configuration, OpenAIApi } = require('openai');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const dotenv = require('dotenv');
const fs = require('fs');
const fsPromises = require('fs').promises;
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'Documents/');
    },
    filename: function(req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });


dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static('public'));

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

async function readDocument(file_path) {
    let dataBuffer = fs.readFileSync(file_path);
    let text;

    if (file_path.endsWith('.pdf')) {
        let data = await pdfParse(dataBuffer);
        text = data.text;
    } else if (file_path.endsWith('.docx')) {
        let result = await mammoth.extractRawText({ buffer: dataBuffer });
        text = result.value;
    } else {
        return [];
    }

    let chunks = [];
    for (let i = 0; i < text.length; i += 2048) {
        chunks.push(text.slice(i, i + 2048));
    }

    return chunks;
}

async function getDocuments() {
    let files = await fsPromises.readdir('Documents');
    return files;
}

async function askQuestion(chunks, question) {
    for (let chunk of chunks) {
        let response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: chunk },
                { role: "assistant", content: "" },
                { role: "user", content: question }
            ]
        });

        // Check if the response contains choices
        if (response.data && response.data.choices && response.data.choices.length > 0) {
            let content = response.data.choices[0].message.content.trim();
            if (content) {
                return content;
            }
        }
    }

    return "I couldn't find an answer to your question in the document.";
}

app.post('/upload', upload.single('file'), (req, res) => {
    // TODO: Add error handling
    res.redirect('/');
});

app.get('/', async (req, res) => {
    let documents = await getDocuments();
    res.render('index', { documents: documents });
});

app.post('/ask', async (req, res) => {
    let documentName = path.join('./Documents', req.body.documentName);
    let question = req.body.question;

    let chunks = await readDocument(documentName);
    let answer = await askQuestion(chunks, question);

    // Delay the response to simulate a loading time
    setTimeout(function() {
        res.render('index', { answer: answer, documents: [req.body.documentName] });
    }, 2000);  // Adjust this value as needed
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});