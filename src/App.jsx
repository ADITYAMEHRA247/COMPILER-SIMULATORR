import React, { useMemo, useRef, useState } from "react";
import { motion as Motion } from "framer-motion";
import "./App.css";

// ---------- Lexical ----------
function tokenize(code) {
  return code
    .replace(/([{}();=+\-*/<>])/g, " $1 ")
    .split(/\s+/)
    .filter(Boolean);
}

function getTokenType(token) {
  if (["int", "float", "double", "char", "void", "if", "else", "for", "while", "return"].includes(token)) {
    return "keyword";
  }
  if (/^\d/.test(token)) return "number";
  if (/^[{}();,]$/.test(token)) return "separator";
  if (/^(==|!=|<=|>=|&&|\|\||[=+\-*/%<>])$/.test(token)) return "operator";
  if (/^".*"$/.test(token)) return "string";
  return "identifier";
}

function getTacType(instruction) {
  if (/^[A-Za-z_]\w*:$/.test(instruction) || /^L\d+:$/.test(instruction)) return "label";
  if (instruction.startsWith("ifFalse") || instruction.startsWith("goto")) return "jump";
  if (instruction.startsWith("declare")) return "declare";
  if (instruction.startsWith("param") || instruction.includes("call")) return "call";
  if (instruction.startsWith("return")) return "return";
  return "assign";
}

function makeError({ line, column = 1, length = 1, type, message, suggestion }) {
  return { line, column, length, type, message, suggestion };
}

function getFirstInvalidCharacter(line) {
  const match = line.match(/[^A-Za-z0-9_#\s{}()[\];=+\-*/<>.,'"\\&|!:%]/);
  return match ? { char: match[0], column: match.index + 1 } : null;
}

function detectLexicalErrors(code) {
  const errors = [];
  const lines = code.split("\n");

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();

    if (!trimmed) return;

    if (trimmed.startsWith("#")) {
      if (!/^#\s*include\s*(<[\w.]+>|"[\w.]+")$/.test(trimmed)) {
        errors.push(
          makeError({
            line: lineNo,
            column: line.indexOf("#") + 1,
            length: Math.max(1, line.trim().length),
            type: "Preprocessor Error",
            message: "Invalid preprocessor directive",
            suggestion: "Use a valid include format, for example: #include <stdio.h>",
          }),
        );
      }
      return;
    }

    const invalidCharacter = getFirstInvalidCharacter(line);
    if (invalidCharacter) {
      errors.push(
        makeError({
          line: lineNo,
          column: invalidCharacter.column,
          length: 1,
          type: "Lexical Error",
          message: `Invalid character '${invalidCharacter.char}'`,
          suggestion: `Remove '${invalidCharacter.char}' or replace it with a valid C character.`,
        }),
      );
    }

    const invalidIdentifier = line.match(/\b\d+[A-Za-z_][A-Za-z0-9_]*\b/);
    if (invalidIdentifier) {
      errors.push(
        makeError({
          line: lineNo,
          column: invalidIdentifier.index + 1,
          length: invalidIdentifier[0].length,
          type: "Lexical Error",
          message: `Invalid identifier '${invalidIdentifier[0]}'`,
          suggestion: "Identifiers must not start with a number. Rename it, for example abc9 or value9.",
        }),
      );
    }

    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      errors.push(
        makeError({
          line: lineNo,
          column: line.indexOf('"') + 1,
          length: Math.max(1, line.length - line.indexOf('"')),
          type: "Lexical Error",
          message: "Unterminated string literal",
          suggestion: 'Add the closing double quote: ".',
        }),
      );
    }
  });

  return errors;
}

// ---------- Syntax (line-based) ----------
function detectErrors(code) {
  const errors = [];
  const lines = code.split("\n");
  const lexicalErrorLines = new Set(detectLexicalErrors(code).map((error) => error.line));
  const hasMainFunction = lines.some((line) =>
    /^(?:int|void|float|double|char)\s+main\s*\([^)]*\)\s*\{?\s*$/.test(line.trim()),
  );

  const braceStack = [];

  if (!hasMainFunction) {
    errors.push(
      makeError({
        line: null,
        type: "Syntax Error",
        message: "Missing main function",
        suggestion: "Add an entry point, for example: int main() { ... }",
      }),
    );
  }

  lines.forEach((line, i) => {
    const l = line.trim();
    const lineNo = i + 1;

    if (!l || l.startsWith("#") || lexicalErrorLines.has(lineNo)) return;

    [...line.matchAll(/{/g)].forEach((match) => {
      braceStack.push({ line: lineNo, column: match.index + 1 });
    });

    [...line.matchAll(/}/g)].forEach((match) => {
      if (braceStack.length > 0) {
        braceStack.pop();
      } else {
        errors.push(
          makeError({
            line: lineNo,
            column: match.index + 1,
            length: 1,
            type: "Syntax Error",
            message: "Unexpected closing brace '}'",
            suggestion: "Remove this brace or add a matching opening brace before it.",
          }),
        );
      }
    });

    const isControl = l.startsWith("if") || l.startsWith("for") || l.startsWith("while");
    const isBraceOnly = l === "{" || l === "}";
    const isBlockStart = l.endsWith("{");
    const isBlockEnd = l.endsWith("}");

    if (isControl && isBlockStart && !l.includes(")")) {
      errors.push(
        makeError({
          line: lineNo,
          column: line.indexOf("{") + 1,
          length: 1,
          type: "Syntax Error",
          message: "Expected ')' before '{'",
          suggestion: "Close the condition before the block, for example: if (x > 0) {",
        }),
      );
    }

    if (!isControl && !isBraceOnly && !isBlockStart && !isBlockEnd) {
      if (!l.endsWith(";")) {
        errors.push(
          makeError({
            line: lineNo,
            column: Math.max(1, line.length),
            length: 1,
            type: "Syntax Error",
            message: "Expected ';' at end of statement",
            suggestion: "Add a semicolon at the end of this line.",
          }),
        );
      }
    }

    if (
      l.includes("=") &&
      !l.includes("==") &&
      !l.includes("=>") &&
      !l.startsWith("if") &&
      !l.startsWith("for")
    ) {
      const parts = l.replace(";", "").split("=");
      if (parts.length !== 2) {
        errors.push(
          makeError({
            line: lineNo,
            column: line.indexOf("=") + 1,
            length: 1,
            type: "Syntax Error",
            message: "Invalid assignment format",
            suggestion: "Use one assignment operator, for example: a = b + c;",
          }),
        );
      }
    }
  });

  braceStack.forEach((brace) => {
    errors.push(
      makeError({
        line: brace.line,
        column: brace.column,
        length: 1,
        type: "Syntax Error",
        message: "Unclosed opening brace '{'",
        suggestion: "Add a matching closing brace '}' after this block.",
      }),
    );
  });

  if (braceStack.length !== 0) {
    errors.push(
      makeError({
        line: null,
        type: "Syntax Error",
        message: "Mismatched braces in program",
        suggestion: "Check every '{' has one matching '}'.",
      }),
    );
  }

  return errors;
}

// ---------- Intermediate code generation ----------
function splitTopLevel(text, separator) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prev = text[i - 1];

    if (char === '"' && prev !== "\\") inString = !inString;
    if (!inString && char === "(") depth++;
    if (!inString && char === ")") depth--;

    if (!inString && depth === 0 && char === separator) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function tokenizeExpression(expression) {
  return (
    expression.match(/"[^"]*"|\d+(?:\.\d+)?|[A-Za-z_]\w*|==|!=|<=|>=|\|\||&&|[()+\-*/%<>,]/g) || []
  );
}

function isOperator(token) {
  return ["||", "&&", "==", "!=", "<", ">", "<=", ">=", "+", "-", "*", "/", "%"].includes(token);
}

function precedence(operator) {
  return {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    "<": 4,
    ">": 4,
    "<=": 4,
    ">=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6,
  }[operator] || 0;
}

function toRpn(tokens) {
  const output = [];
  const operators = [];

  tokens.forEach((token) => {
    if (token === "(") {
      operators.push(token);
    } else if (token === ")") {
      while (operators.length && operators[operators.length - 1] !== "(") {
        output.push(operators.pop());
      }
      operators.pop();
    } else if (isOperator(token)) {
      while (
        operators.length &&
        isOperator(operators[operators.length - 1]) &&
        precedence(operators[operators.length - 1]) >= precedence(token)
      ) {
        output.push(operators.pop());
      }
      operators.push(token);
    } else if (token !== ",") {
      output.push(token);
    }
  });

  while (operators.length) output.push(operators.pop());
  return output;
}

function generateTAC(code) {
  const lines = code.split("\n").map((line) => line.trim()).filter(Boolean);
  let tempCount = 1;
  let labelCount = 1;
  const out = [];
  const blockStack = [];

  const nextTemp = () => `t${tempCount++}`;
  const nextLabel = () => `L${labelCount++}`;

  const emitExpression = (expression) => {
    const expr = expression.trim().replace(/;$/, "");
    const callMatch = expr.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/);

    if (callMatch) {
      const args = splitTopLevel(callMatch[2], ",");
      args.forEach((arg) => out.push(`param ${emitExpression(arg)}`));
      const result = nextTemp();
      out.push(`${result} = call ${callMatch[1]}, ${args.length}`);
      return result;
    }

    const tokens = tokenizeExpression(expr);
    if (tokens.length <= 1) return tokens[0] || expr;

    const stack = [];
    const rpn = toRpn(tokens);

    rpn.forEach((token) => {
      if (!isOperator(token)) {
        stack.push(token);
        return;
      }

      const right = stack.pop();
      const left = stack.pop();
      const temp = nextTemp();
      out.push(`${temp} = ${left} ${token} ${right}`);
      stack.push(temp);
    });

    return stack[0] || expr;
  };

  const emitAssignment = (statement) => {
    const clean = statement.replace(/;$/, "").trim();
    const assignment = clean.match(/^([A-Za-z_]\w*)\s*([+\-*/%]?=)\s*(.+)$/);
    if (!assignment) return false;

    const [, left, operator, right] = assignment;
    if (operator === "=") {
      out.push(`${left} = ${emitExpression(right)}`);
    } else {
      const op = operator[0];
      const temp = emitExpression(`${left} ${op} (${right})`);
      out.push(`${left} = ${temp}`);
    }
    return true;
  };

  const emitDeclaration = (statement) => {
    const declarationMatch = statement.match(/^(int|float|double|char)\s+(.+);$/);
    if (!declarationMatch) return false;

    const [, type, declarationList] = declarationMatch;
    splitTopLevel(declarationList, ",").forEach((declaration) => {
      const [name, value] = declaration.split("=").map((part) => part.trim());
      out.push(`declare ${type} ${name}`);
      if (value) out.push(`${name} = ${emitExpression(value)}`);
    });
    return true;
  };

  const emitConditionJump = (condition, falseLabel) => {
    const result = emitExpression(condition);
    out.push(`ifFalse ${result} goto ${falseLabel}`);
  };

  for (const rawLine of lines) {
    let line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;

    const functionHeader = line.match(/^(?:int|void|float|double|char)\s+([A-Za-z_]\w*)\s*\((.*)\)\s*\{$/);
    if (functionHeader) {
      out.push(`${functionHeader[1]}:`);
      splitTopLevel(functionHeader[2], ",")
        .filter(Boolean)
        .forEach((param) => out.push(`param_in ${param.trim()}`));
      continue;
    }

    if (/^}\s*else\s*\{$/.test(line)) {
      const block = blockStack.pop();
      const afterElse = nextLabel();

      if (block?.type === "if") {
        out.push(`goto ${afterElse}`);
        out.push(`${block.falseLabel}:`);
        blockStack.push({ type: "else", end: afterElse });
      }
      continue;
    }

    if (line === "}") {
      const block = blockStack.pop();
      if (block?.type === "while") {
        out.push(`goto ${block.start}`);
        out.push(`${block.end}:`);
      } else if (block?.type === "for") {
        emitAssignment(`${block.update};`);
        out.push(`goto ${block.start}`);
        out.push(`${block.end}:`);
      } else if (block?.type === "if") {
        out.push(`${block.falseLabel}:`);
      } else if (block?.end) {
        out.push(`${block.end}:`);
      }
      continue;
    }

    const whileMatch = line.match(/^while\s*\((.*)\)\s*\{$/);
    if (whileMatch) {
      const start = nextLabel();
      const end = nextLabel();
      out.push(`${start}:`);
      emitConditionJump(whileMatch[1], end);
      blockStack.push({ type: "while", start, end });
      continue;
    }

    const ifMatch = line.match(/^if\s*\((.*)\)\s*\{$/);
    if (ifMatch) {
      const falseLabel = nextLabel();
      emitConditionJump(ifMatch[1], falseLabel);
      blockStack.push({ type: "if", falseLabel });
      continue;
    }

    const forMatch = line.match(/^for\s*\((.*);(.*);(.*)\)\s*\{$/);
    if (forMatch) {
      const [, init, condition, update] = forMatch;
      const start = nextLabel();
      const end = nextLabel();
      if (!emitDeclaration(`${init};`)) emitAssignment(`${init};`);
      out.push(`${start}:`);
      emitConditionJump(condition, end);
      blockStack.push({ type: "for", start, end, update });
      continue;
    }

    const returnMatch = line.match(/^return\s+(.+);$/);
    if (returnMatch) {
      out.push(`return ${emitExpression(returnMatch[1])}`);
      continue;
    }

    if (emitDeclaration(line)) {
      continue;
    }

    const callStatement = line.match(/^([A-Za-z_]\w*)\s*\((.*)\);$/);
    if (callStatement) {
      const args = splitTopLevel(callStatement[2], ",");
      args.forEach((arg) => out.push(`param ${emitExpression(arg)}`));
      out.push(`call ${callStatement[1]}, ${args.length}`);
      continue;
    }

    emitAssignment(line);
  }

  while (blockStack.length) {
    const block = blockStack.pop();
    if (block.type === "while" || block.type === "for") {
      out.push(`goto ${block.start}`);
      out.push(`${block.end}:`);
    } else if (block.type === "if") {
      out.push(`${block.falseLabel}:`);
    } else if (block.end) {
      out.push(`${block.end}:`);
    }
  }

  return out;
}

function ErrorList({ errors, code }) {
  const lines = code.split("\n");

  return (
    <div className="errList">
      {errors.map((e, i) => {
        const sourceLine = typeof e.line === "number" ? lines[e.line - 1] || "" : "";
        const column = Math.max(1, e.column || 1);
        const length = Math.max(1, e.length || 1);
        const caretPadding = " ".repeat(Math.max(0, column - 1));
        const caretUnderline = "^".repeat(length);

        return (
          <div key={i} className="errItem">
            <div className="errTitle">
              {typeof e.line === "number"
                ? `input.c:${e.line}:${column}: error: ${e.message}`
                : `input.c: error: ${e.message}`}
            </div>
            <div className="errType">{e.type}</div>
            {typeof e.line === "number" && (
              <pre className="errCode">
                {sourceLine || " "}
                {"\n"}
                {caretPadding}
                {caretUnderline}
              </pre>
            )}
            {e.suggestion && <div className="errSuggestion">Suggestion: {e.suggestion}</div>}
          </div>
        );
      })}
    </div>
  );
}

function OverlayLine({ line, ranges }) {
  if (!ranges.length) {
    return <>{line.length ? line : " "}</>;
  }

  const parts = [];
  let cursor = 0;

  ranges
    .map((range) => ({
      start: Math.max(0, range.column - 1),
      end: Math.min(line.length || 1, Math.max(0, range.column - 1) + Math.max(1, range.length || 1)),
    }))
    .sort((a, b) => a.start - b.start)
    .forEach((range, i) => {
      if (range.start > cursor) {
        parts.push(<span key={`plain-${i}`}>{line.slice(cursor, range.start)}</span>);
      }

      const text = line.slice(range.start, range.end) || " ";
      parts.push(
        <span key={`err-${i}`} className="overlayUnderline">
          {text}
        </span>,
      );
      cursor = Math.max(cursor, range.end);
    });

  if (cursor < line.length) {
    parts.push(<span key="tail">{line.slice(cursor)}</span>);
  }

  return parts;
}

export default function CompilerSimulator() {
  const [code, setCode] = useState(`int a = b + c * 5;\nint d = a + 2;`);
  const [step, setStep] = useState(0);
  const [compileRun, setCompileRun] = useState(0);
  const [editorHeight, setEditorHeight] = useState(180);
  const gutterRef = useRef(null);
  const overlayRef = useRef(null);
  const resizeRef = useRef({ startY: 0, startHeight: 180 });

  const tokens = useMemo(() => tokenize(code), [code]);
  const lexicalErrors = useMemo(() => detectLexicalErrors(code), [code]);
  const syntaxErrors = useMemo(() => detectErrors(code), [code]);

  const errors = useMemo(() => [...lexicalErrors, ...syntaxErrors], [lexicalErrors, syntaxErrors]);
  const errorLines = useMemo(() => {
    const s = new Set();
    for (const e of errors) if (typeof e.line === "number") s.add(e.line);
    return s;
  }, [errors]);
  const errorRangesByLine = useMemo(() => {
    const map = new Map();

    for (const e of errors) {
      if (typeof e.line !== "number") continue;
      const ranges = map.get(e.line) || [];
      ranges.push({ column: e.column || 1, length: e.length || 1 });
      map.set(e.line, ranges);
    }

    return map;
  }, [errors]);

  const tac = errors.length === 0 ? generateTAC(code) : [];

  const run = () => {
    setCompileRun((current) => current + 1);
    setStep(0);
    setTimeout(() => setStep(1), 80);
    setTimeout(() => setStep(2), 800);
    setTimeout(() => setStep(3), 1600);
  };

  // Controlled textarea with overlay underline
  const lines = code.split("\n");

  const syncEditorScroll = (e) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.target.scrollTop;
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.target.scrollTop;
      overlayRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const startResize = (e) => {
    resizeRef.current = { startY: e.clientY, startHeight: editorHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const resizeEditor = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const nextHeight = resizeRef.current.startHeight + e.clientY - resizeRef.current.startY;
    setEditorHeight(Math.max(120, Math.min(520, nextHeight)));
  };

  return (
    <div className="page">
      <div className="shell">
        <div className="heroHeader">
          <h1 className="title">Compiler Simulator</h1>
          <div className="subtitle">Lexical Analysis <span /> Syntax Analysis <span /> Three Address Code</div>
        </div>

        <div className="capabilityPanel fadeIn">
          <div className="capabilityIntro">
            <div className="phaseBadge">Project Scope</div>
            <h2>Detectable Errors & Functionalities</h2>
          </div>
          <div className="capabilityGrid">
            <div className="capabilityItem">
              <span>Lexical Errors</span>
              <p>Invalid characters, invalid identifiers, unterminated strings, and malformed include directives.</p>
            </div>
            <div className="capabilityItem">
              <span>Syntax Errors</span>
              <p>Missing semicolons, mismatched braces, invalid assignments, incomplete conditions, and missing main function.</p>
            </div>
            <div className="capabilityItem">
              <span>Compiler Flow</span>
              <p>Animated lexical analysis, syntax validation, diagnostics with suggestions, and three address code generation.</p>
            </div>
          </div>
        </div>

        {/* INPUT */}
        <div className="card fadeIn">
          <div className="cardHeader">
            <h2>User Input</h2>
          </div>
          <div className="fieldLabel">Type C-like code. Diagnostics update as you edit.</div>

          {/* Line-numbered + underlined textarea */}
          <div className="editorShell">
            <div className="textareaWrap" style={{ height: editorHeight }}>
              <div className="textareaGutter" ref={gutterRef}>
                {lines.map((_, i) => (
                  <div
                    key={i}
                    className={errorLines.has(i + 1) ? "gutterLine gutterLineErr" : "gutterLine"}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>

              <div className="textareaOverlay" ref={overlayRef} aria-hidden="true">
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className={errorLines.has(i + 1) ? "overlayLine overlayLineErr" : "overlayLine"}
                  >
                    <OverlayLine line={line} ranges={errorRangesByLine.get(i + 1) || []} />
                  </div>
                ))}
              </div>

              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onScroll={syncEditorScroll}
                className="textarea textareaTop"
                spellCheck={false}
                wrap="off"
              />
            </div>
            <div
              className="resizeHandle"
              onPointerDown={startResize}
              onPointerMove={resizeEditor}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize input editor"
              title="Drag to resize"
            >
              <span />
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={run} className="btn">
              Run Compiler
            </button>
          </div>
        </div>

        {/* TOP GRID */}
        <div className="phaseFlow">
          {/* LEXICAL */}
          {step >= 1 && (
            <Motion.div
              key={`lexical-${compileRun}`}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.35 }}
              className="phaseCard lexicalPhase runningPhase"
            >
              <div className="phaseScanner" />
              <div className="phaseTop">
                <div>
                  <div className="phaseBadge">Phase 01</div>
                  <h2 className="sectionTitle">Lexical Analysis</h2>
                </div>
                <div className={lexicalErrors.length > 0 ? "phaseStatus badStatus" : "phaseStatus okStatus"}>
                  {lexicalErrors.length > 0 ? `${lexicalErrors.length} error` : `${tokens.length} tokens`}
                </div>
              </div>

              {lexicalErrors.length > 0 ? (
                <div className="err">
                  <ErrorList errors={lexicalErrors} code={code} />
                </div>
              ) : (
                <div className="tokenBoard">
                  {tokens.map((t, i) => (
                    <Motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, scale: [0.96, 1.04, 1] }}
                      transition={{ delay: Math.min(i * 0.04, 0.7), duration: 0.32 }}
                      className={`tokenChip ${getTokenType(t)}`}
                    >
                      <span>{getTokenType(t)}</span>
                      <strong>{t}</strong>
                    </Motion.div>
                  ))}
                </div>
              )}
            </Motion.div>
          )}

          {/* SYNTAX */}
          {step >= 2 && (
            <Motion.div
              key={`syntax-${compileRun}`}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.35 }}
              className="phaseCard syntaxPhase runningPhase"
            >
              <div className="phaseScanner" />
              <div className="phaseTop">
                <div>
                  <div className="phaseBadge">Phase 02</div>
                  <h2 className="sectionTitle">Syntax Analysis</h2>
                </div>
                <div className={errors.length > 0 ? "phaseStatus badStatus" : "phaseStatus okStatus"}>
                  {errors.length > 0 ? `${errors.length} diagnostic` : "valid structure"}
                </div>
              </div>

              {errors.length === 0 ? (
                <div className="syntaxSuccess">
                  <Motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.12, type: "spring", stiffness: 260, damping: 18 }}
                    className="syntaxNode rootNode"
                  >
                    Program
                  </Motion.div>
                  <div className="syntaxBranches animatedBranches">
                    {["Declarations", "Statements", "Expressions"].map((label, i) => (
                      <Motion.div
                        key={label}
                        initial={{ opacity: 0, y: 14, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: 0.28 + i * 0.14, type: "spring", stiffness: 240, damping: 18 }}
                        className="syntaxNode"
                      >
                        {label}
                      </Motion.div>
                    ))}
                  </div>
                  <div className="ok">No syntax errors detected</div>
                </div>
              ) : (
                <div className="err">
                  <ErrorList errors={errors} code={code} />
                </div>
              )}
            </Motion.div>
          )}
        </div>

        {/* TAC */}
        {step >= 3 && (
          <Motion.div
            key={`tac-${compileRun}`}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35 }}
            className="phaseCard tacPhase runningPhase"
          >
            <div className="phaseScanner" />
            <div className="phaseTop">
              <div>
                <div className="phaseBadge">Phase 03</div>
                <h2 className="sectionTitle">Three Address Code</h2>
              </div>
              <div className={tac.length === 0 ? "phaseStatus badStatus" : "phaseStatus okStatus"}>
                {tac.length === 0 ? "blocked" : `${tac.length} instructions`}
              </div>
            </div>

            {tac.length === 0 ? (
              <div className="err">No intermediate code generated (fix errors first).</div>
            ) : (
              <div className="tacConsole">
                {tac.map((t, i) => (
                  <Motion.div
                    key={i}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.06, 0.8), duration: 0.28 }}
                    className={`tacRow ${getTacType(t)}`}
                  >
                    <span className="tacLine">{String(i + 1).padStart(2, "0")}</span>
                    <code>{t}</code>
                  </Motion.div>
                ))}
              </div>
            )}
          </Motion.div>
        )}
      </div>
    </div>
  );
}
