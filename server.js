const express = require('express');
const { Configuration, OpenAIApi } = require('openai');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const dotenv = require('dotenv');
const fs = require('fs');
const fsPromises = require('fs').promises;
const multer = require('multer');
const path = require('path');
const textract = require('textract');
const XLSX = require('xlsx');
const csv = require('csv-parser');

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'Documents/');
    },
    filename: function(req, file, cb) {
        cb(null, file.originalname); // Use the original filename
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
    let text;

    if (file_path.endsWith('.pdf')) {
        let dataBuffer = fs.readFileSync(file_path);
        let data = await pdfParse(dataBuffer);
        text = data.text;
    } else if (file_path.endsWith('.docx')) {
        let dataBuffer = fs.readFileSync(file_path);
        let result = await mammoth.extractRawText({ buffer: dataBuffer });
        text = result.value;
    } else if (file_path.endsWith('.pptx')) {
        text = await new Promise((resolve, reject) => {
            textract.fromFileWithPath(file_path, { type: 'pptx' }, function(error, text) {
                if (error) {
                    reject(error);
                } else {
                    resolve(text);
                }
            });
        });
    } else if (file_path.endsWith('.xlsx')) {
        let workbook = XLSX.readFile(file_path);
        text = '';
        workbook.SheetNames.forEach(function(sheetName) {
            let worksheet = workbook.Sheets[sheetName];
            let jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            jsonData.forEach(function(row) {
                text += row.join(' ') + '\n';
            });
        });
    } else if (file_path.endsWith('.csv')) {
        text = await new Promise((resolve, reject) => {
            let rows = [];
            fs.createReadStream(file_path)
                .pipe(csv())
                .on('data', (row) => {
                    rows.push(Object.values(row).join(' '));
                })
                .on('end', () => {
                    resolve(rows.join('\n'));
                })
                .on('error', reject);
        });
    } else {
        return [];
    }

    let chunks = [];
    if (file_path.endsWith('.pptx')) {
        let slides = text.split('\n\n'); // Split the text into slides
        for (let slide of slides) {
            let slideChunks = slide.match(/.{1,2048}/g); // Split each slide into chunks
            if (slideChunks) {
                chunks.push(...slideChunks);
            }
        }
    } else {
        for (let i = 0; i < text.length; i += 2048) {
            chunks.push(text.slice(i, i + 2048));
        }
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
                { role: "system", content: "Respond using markdown." },
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
    res.redirect('/app');
});

app.get('/', async (req, res) => {
    res.render('index');
});

app.get('/app', async (req, res) => {
    let documents = await getDocuments();
    res.render('app', { documents: documents });
});

app.post('/ask', async (req, res) => {
    let documentName = req.body.documentName;
    let extension = path.extname(documentName);
    let fullPath = path.join('./Documents', documentName);

    let text;
    switch (extension) {
        case '.pdf':
            text = await textract.fromFileWithPath(fullPath, { type: 'pdf' });
            break;
        case '.docx':
            text = await textract.fromFileWithPath(fullPath, { type: 'docx' });
            break;
        case '.pptx':
            text = await textract.fromFileWithPath(fullPath, { type: 'pptx' });
            break;
        default:
            // Handle unsupported file types
            break;
    }

    let question = req.body.question;

    let chunks = await readDocument(fullPath); // Pass the full path to readDocument
    let answer = await askQuestion(chunks, question);

    // Delay the response to simulate a loading time
    setTimeout(function() {
        res.render('app', { answer: answer, documents: [req.body.documentName] }); // Render 'app' instead of 'index'
    }, 2000);  // Adjust this value as needed
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});