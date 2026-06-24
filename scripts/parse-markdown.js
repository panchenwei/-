const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");

const sourceMarkdown =
  process.argv[2] ||
  findFirstFile((name) => /^MinerU_markdown_.*list_1-20.*\.md$/i.test(name));
const sourcePdf =
  process.argv[3] ||
  findFirstFile((name) => /list 1-20\.pdf$/i.test(name) && /同义词专项训练/i.test(name));

if (!sourceMarkdown) {
  throw new Error("Source markdown file was not found.");
}

if (!sourcePdf) {
  throw new Error("Source PDF file was not found.");
}

const markdownText = fs.readFileSync(sourceMarkdown, "utf8").replace(/\r\n/g, "\n");
const pdfPages = extractPdfPages(sourcePdf);
const chapters = parseChapters(markdownText, pdfPages);

validateChapters(chapters);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, "chapters.json"), JSON.stringify(chapters, null, 2), "utf8");
fs.writeFileSync(path.join(DATA_DIR, "chapters.js"), `window.CHAPTERS = ${JSON.stringify(chapters, null, 2)};\n`, "utf8");

console.log(`Generated ${chapters.length} chapters from:`);
console.log(`- Markdown: ${sourceMarkdown}`);
console.log(`- PDF: ${sourcePdf}`);
console.log(`Output: ${path.join(DATA_DIR, "chapters.json")}`);

function findFirstFile(predicate) {
  const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && predicate(entry.name));
  return match ? path.join(WORKSPACE_ROOT, match.name) : null;
}

function extractPdfPages(pdfPath) {
  const pythonScript = `
import json
import sys
from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
pages = []
for page in reader.pages:
    text = page.extract_text() or ""
    pages.append(text.replace("\\r\\n", "\\n"))

print(json.dumps(pages, ensure_ascii=False))
`;

  const output = execFileSync("python", ["-X", "utf8", "-c", pythonScript, pdfPath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

  return JSON.parse(output);
}

function parseChapters(text, pdfPages) {
  const answerMarkers = [...text.matchAll(/(?:^|\n)(?:##\s*)?List\s+(\d+)\s+Answers\b/gi)];
  if (answerMarkers.length !== 20) {
    throw new Error(`Expected 20 answer blocks, found ${answerMarkers.length}.`);
  }

  const listOneStart = text.indexOf("List 1 Paraphrases");
  if (listOneStart === -1) {
    throw new Error("Could not locate List 1 Paraphrases.");
  }

  let cursor = listOneStart;
  const chapters = [];

  for (let chapterNumber = 1; chapterNumber <= 20; chapterNumber += 1) {
    const answerMarker = answerMarkers[chapterNumber - 1];
    const answerStart = answerMarker.index + (answerMarker[0].startsWith("\n") ? 1 : 0);
    const answerEnd = findAnswerEnd(text, answerStart, chapterNumber);

    const rawBlock = text.slice(cursor, answerStart).trim();
    const answerBlock = text.slice(answerStart, answerEnd).trim();

    chapters.push(parseChapterBlock(chapterNumber, rawBlock, answerBlock, pdfPages));
    cursor = answerEnd;
  }

  return chapters;
}

function findAnswerEnd(text, answerStart, chapterNumber) {
  const tail = text.slice(answerStart);
  const pattern = new RegExp(String.raw`Test\s*yourself\s*答案[^\n]*List\s*${chapterNumber}\b`, "i");
  const match = pattern.exec(tail);
  if (!match) {
    throw new Error(`Could not locate the end of List ${chapterNumber} answers.`);
  }
  return answerStart + match.index + match[0].length;
}

function parseChapterBlock(chapterNumber, rawBlock, answerBlock, pdfPages) {
  const matchingMarker = rawBlock.indexOf("## Matching Practice");
  const choicesMarker = rawBlock.indexOf("## Choices");
  const testMarker = rawBlock.indexOf("## Test Yourself");

  if ([matchingMarker, choicesMarker, testMarker].some((index) => index === -1)) {
    throw new Error(`List ${chapterNumber} is missing one or more section markers.`);
  }

  const paraphraseSection = rawBlock.slice(0, matchingMarker);
  const matchingSection = rawBlock.slice(matchingMarker, choicesMarker);
  const choicesSection = rawBlock.slice(choicesMarker, testMarker);
  const testSection = rawBlock.slice(testMarker);

  const paraphrases = parseParaphrases(paraphraseSection);
  const answers = parseAnswers(answerBlock);
  const matching = parseMatching(matchingSection, answers.matching);
  const markdownChoices = parseChoices(choicesSection, answers.choices);
  const pdfChoices = parseChoicesFromPdf(pdfPages, chapterNumber, answers.choices);
  const choices = shouldUsePdfChoices(markdownChoices) ? pdfChoices : markdownChoices;
  const testYourself = parseTestYourself(testSection, paraphrases);

  return {
    id: `list-${chapterNumber}`,
    number: chapterNumber,
    title: `List ${chapterNumber}`,
    paraphrases,
    matching,
    choices,
    testYourself,
    answers,
  };
}

function parseParaphrases(sectionText) {
  const cleaned = sectionText
    .replace(/List\s+\d+\s+Paraphrases/gi, "")
    .replace(/!\[image\]\([^)]+\)/g, "")
    .replace(/\u00a0/g, " ");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(line) || /^\d+\./.test(line));

  return lines.map((line, index) => {
    let value = line
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, "")
      .replace(/^\d+\.\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    const firstCjkIndex = value.search(/[\u3400-\u9fff]/);
    const englishPart = firstCjkIndex >= 0 ? value.slice(0, firstCjkIndex).trim() : value;
    const meaningZh = firstCjkIndex >= 0 ? value.slice(firstCjkIndex).trim() : "";

    let partOfSpeech = "";
    let termPart = englishPart;
    const posMatch = termPart.match(/\b(v|n|a|ad|adj|adv|vt|vi)\.?$/i);
    if (posMatch) {
      partOfSpeech = posMatch[1].toLowerCase();
      termPart = termPart.slice(0, posMatch.index).trim();
    }

    const terms = termPart
      .split(/\s*(?:-|–|\/)\s*/g)
      .map((term) => term.trim())
      .filter(Boolean);

    return {
      id: `p${index + 1}`,
      order: index + 1,
      headword: terms[0] || "",
      synonyms: terms.slice(1),
      allTerms: uniqueList(terms),
      partOfSpeech,
      meaningZh: safeNormalizeChineseText(meaningZh),
      sourceLine: value,
    };
  });
}

function parseMatching(sectionText, answerMap) {
  const rows = extractTableRows(extractFirstTable(sectionText));
  const prompts = [];
  const options = [];

  rows.forEach((cells, index) => {
    const promptText = cleanHtmlText(cells[1] || "");
    const optionMatch = cleanHtmlText(cells[cells.length - 1] || "").match(/^([A-J])\.\s*(.+)$/);
    if (!optionMatch) {
      throw new Error(`Matching option parse failed for row ${index + 1}.`);
    }

    const promptId = `m${index + 1}`;
    prompts.push({
      id: promptId,
      number: index + 1,
      text: promptText.replace(/^\d+\.\s*/, "").trim(),
      correctOptionId: answerMap[promptId],
    });

    options.push({
      id: optionMatch[1],
      text: optionMatch[2].trim(),
    });
  });

  return { prompts, options, answerMap };
}

function parseChoices(sectionText, answerLetters) {
  const body = sectionText.replace(/^##\s*Choices[^\n]*\n?/i, "").replace(/\u00a0/g, " ").trim();
  return parseChoiceQuestionText(body, answerLetters);
}

function parseChoicesFromPdf(pdfPages, chapterNumber, answerLetters) {
  const basePage = 2 + (chapterNumber - 1) * 4;
  const choicePages = [pdfPages[basePage + 1] || "", pdfPages[basePage + 2] || ""].join("\n");
  const marker = choicePages.indexOf("Choices");
  if (marker === -1) {
    throw new Error(`Could not locate PDF choices for List ${chapterNumber}.`);
  }

  const body = choicePages
    .slice(marker)
    .replace(/^.*?Choices\s*[–-]\s*odd one out\s*选非题/i, "")
    .trim();

  return parseChoiceQuestionText(body, answerLetters);
}

function parseChoiceQuestionText(sectionText, answerLetters) {
  const flattened = sectionText
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+\d+\s+(?=\d+\.\s*下面)/g, " ")
    .trim();

  const regex =
    /(?:(\d+)\.\s*)?(下面[那哪]个不是.*?)[ ]A[\.．]\s*(.*?)[ ]B[\.．]\s*(.*?)[ ]C[\.．]\s*(.*?)[ ]D[\.．]\s*(.*?)(?=(?:(?:\s+\d+\.\s*|\s+)下面[那哪]个不是)|$)/g;

  const matches = [...flattened.matchAll(regex)];
  if (matches.length) {
    return matches.map((match, index) => {
      const number = match[1] ? Number(match[1]) : index + 1;
      return {
        id: `c${number}`,
        number,
        question: match[2].trim(),
        options: [
          { id: "A", text: match[3].trim() },
          { id: "B", text: match[4].trim() },
          { id: "C", text: match[5].trim() },
          { id: "D", text: match[6].trim() },
        ],
        correctOption: answerLetters[`c${number}`],
      };
    });
  }

  const lines = flattened
    .replace(/(?!^)(\d+\.\s*下面[那哪]个不是|下面[那哪]个不是)/g, "\n$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Choices\b/i.test(line));

  return lines.map((line, index) => {
    const numberMatch = line.match(/^(\d+)\.\s*/);
    const number = numberMatch ? Number(numberMatch[1]) : index + 1;
    const text = line.replace(/^\d+\.\s*/, "").trim();
    const optionMatches = [...text.matchAll(/([A-DＡ-Ｄ])[\.．]\s*([\s\S]*?)(?=(?:\s+[A-DＡ-Ｄ][\.．]\s*)|$)/g)];

    return {
      id: `c${number}`,
      number,
      question: optionMatches[0] ? text.slice(0, optionMatches[0].index).trim() : text,
      options: optionMatches.map((match) => ({
        id: normalizeLetter(match[1]),
        text: match[2].trim(),
      })),
      correctOption: answerLetters[`c${number}`],
    };
  });
}

function shouldUsePdfChoices(markdownChoices) {
  return markdownChoices.length !== 10 || markdownChoices.some((choice) => choice.options.length < 4 || !choice.question);
}

function parseTestYourself(sectionText, paraphrases) {
  const rows = extractTableRows(extractFirstTable(sectionText));

  return rows.map((cells, index) => {
    const promptZh = cleanHtmlText(cells[0] || "").replace(/^\d+\.\s*/, "").trim();
    const paraphrase = findBestParaphraseForPrompt(promptZh, paraphrases);

    return {
      id: `t${index + 1}`,
      number: index + 1,
      promptZh: safeNormalizeChineseText(promptZh),
      acceptedAnswers: uniqueList(paraphrase ? paraphrase.allTerms : []),
    };
  });
}

function findBestParaphraseForPrompt(promptZh, paraphrases) {
  const promptTokens = safeTokenizeChineseMeaning(promptZh);
  const promptKey = safeNormalizeChineseText(promptZh);
  let best = null;
  let bestScore = -1;

  for (const paraphrase of paraphrases) {
    const meaningTokens = safeTokenizeChineseMeaning(paraphrase.meaningZh);
    const meaningKey = safeNormalizeChineseText(paraphrase.meaningZh);
    let score = 0;

    for (const token of promptTokens) {
      if (meaningTokens.includes(token)) {
        score += 3;
      } else if (meaningKey.includes(token)) {
        score += 2;
      }
    }

    if (promptKey && (promptKey === meaningKey || meaningKey.includes(promptKey) || promptKey.includes(meaningKey))) {
      score += 4;
    }

    score += sharedChineseCharCount(promptKey, meaningKey) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = paraphrase;
    }
  }

  return bestScore > 0 ? best : null;
}

function sharedChineseCharCount(left, right) {
  const leftChars = [...new Set((left.match(/[\u3400-\u9fff]/g) || []))];
  const rightSet = new Set(right.match(/[\u3400-\u9fff]/g) || []);
  return leftChars.filter((char) => rightSet.has(char)).length;
}

function safeNormalizeChineseText(text) {
  return String(text)
    .replace(/\s+/g, "")
    .replace(/[\uFF0C,]/g, "\uFF0C")
    .replace(/[\uFF1B;]/g, "\uFF1B")
    .replace(/[\uFF1A:]/g, "\uFF1A")
    .replace(/[\u3002.]/g, "")
    .trim();
}

function safeTokenizeChineseMeaning(text) {
  return safeNormalizeChineseText(text)
    .split(/[\uFF0C\uFF1B\uFF1A]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseAnswers(answerBlock) {
  const normalized = answerBlock.replace(/\s*(Matching|Choices|Test yourself)/g, "\n$1");
  const matchingSlice = captureBetween(normalized, /Matching\s*答案[:：]/i, /Choices\s*答案[:：]/i);
  const choicesSlice = captureBetween(normalized, /Choices\s*答案[:：]/i, /Test\s*yourself/i);

  const matching = {};
  for (const [, index, letter] of matchingSlice.matchAll(/(\d+)\s*[-–—]\s*([A-J])/g)) {
    matching[`m${index}`] = letter;
  }

  const choices = {};
  for (const [, index, letter] of choicesSlice.matchAll(/(\d+)\s*[-–—]\s*([A-D])/g)) {
    choices[`c${index}`] = letter;
  }

  return { matching, choices };
}

function captureBetween(text, startRegex, endRegex) {
  const startMatch = startRegex.exec(text);
  if (!startMatch) return "";
  const tail = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = endRegex.exec(tail);
  return endMatch ? tail.slice(0, endMatch.index) : tail;
}

function extractFirstTable(text) {
  const match = text.match(/<table>[\s\S]*?<\/table>/i);
  if (!match) {
    throw new Error("Expected an HTML table but none was found.");
  }
  return match[0];
}

function extractTableRows(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  return rows.map((row) =>
    [...row[1].matchAll(/<td(?:\s+[^>]*)?>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]),
  );
}

function cleanHtmlText(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChineseText(text) {
  return text
    .replace(/\s+/g, "")
    .replace(/[，,]/g, "，")
    .replace(/[；;]/g, "；")
    .replace(/[：:]/g, "：")
    .replace(/[。\.]/g, "")
    .trim();
}

function tokenizeChineseMeaning(text) {
  return normalizeChineseText(text)
    .split(/[，；：]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeLetter(value) {
  return value
    .replace("Ａ", "A")
    .replace("Ｂ", "B")
    .replace("Ｃ", "C")
    .replace("Ｄ", "D");
}

function uniqueList(values) {
  return [...new Set(values)];
}

function validateChapters(chapters) {
  if (chapters.length !== 20) {
    throw new Error(`Expected 20 chapters, received ${chapters.length}.`);
  }

  for (const chapter of chapters) {
    const problems = [];
    if (chapter.paraphrases.length !== 10) problems.push(`paraphrases=${chapter.paraphrases.length}`);
    if (chapter.matching.prompts.length !== 10) problems.push(`matching prompts=${chapter.matching.prompts.length}`);
    if (chapter.matching.options.length !== 10) problems.push(`matching options=${chapter.matching.options.length}`);
    if (chapter.choices.length !== 10) problems.push(`choices=${chapter.choices.length}`);
    if (chapter.testYourself.length !== 10) problems.push(`test=${chapter.testYourself.length}`);
    if (chapter.choices.some((choice) => choice.options.length < 4)) problems.push("incomplete choice options");
    if (chapter.testYourself.some((item) => item.acceptedAnswers.length === 0)) problems.push("empty test answers");

    if (problems.length) {
      throw new Error(`List ${chapter.number} validation failed: ${problems.join(", ")}`);
    }
  }
}
