// ── Playground starter library (deterministic local content) ─────────────────
// Every exercise, SQL schema and sample workbook is static text shipped with
// the app: the playground opens fully offline and never needs the model to
// generate starting content. Nothing here claims that code or formulas were
// executed — task text may ASK the user to predict/analyse, and the UI labels
// every model answer as analysis, not execution.

import type { ExcelSheet } from './playground-types'

export interface StarterExercise {
  id: string
  languageId: string
  title: string
  level: 'beginner' | 'intermediate' | 'advanced'
  /** The task description shown above the editor / sent with analysis. */
  problem: string
  /** Starter code (may contain a deliberate mistake for practice). */
  code: string
}

export const STARTERS: StarterExercise[] = [
  // ── Python ─────────────────────────────────────────────────────────────────
  {
    id: 'py-average-bug',
    languageId: 'python',
    title: 'Average of a list (find the bug)',
    level: 'beginner',
    problem:
      'This function should return the average of a list of numbers. It works for some inputs but returns wrong values for others. Find the bug and explain the fix, then try a corrected version.',
    code: [
      'def average(numbers):',
      '    total = 0',
      '    for i in range(1, len(numbers)):',
      '        total += numbers[i]',
      '    return total / len(numbers)',
      '',
      'print(average([4, 8, 15, 16, 23, 42]))',
      '',
    ].join('\n'),
  },
  {
    id: 'py-word-frequency',
    languageId: 'python',
    title: 'Word frequency report',
    level: 'intermediate',
    problem:
      'Count the words in the sample text (case-insensitive, punctuation stripped) and print the three most common words with their counts. Keep the pipeline readable and explain the data structures you use.',
    code: [
      'text = "The quick brown fox jumps over the lazy dog. The dog barks, the fox runs."',
      '',
      'def word_frequencies(raw):',
      '    counts = {}',
      '    for word in raw.split():',
      '        counts[word] = counts.get(word, 0) + 1',
      '    return counts',
      '',
      'freq = word_frequencies(text)',
      'print(freq)',
      '',
    ].join('\n'),
  },
  {
    id: 'py-inventory-class',
    languageId: 'python',
    title: 'Class-based inventory report',
    level: 'advanced',
    problem:
      'Model the inventory with a small class hierarchy (or dataclasses). Add stock checks, restock thresholds and a report method. Discuss where dataclasses would simplify the design and what invariants the class should enforce.',
    code: [
      'class Item:',
      '    def __init__(self, sku, name, quantity, reorder_at):',
      '        self.sku = sku',
      '        self.name = name',
      '        self.quantity = quantity',
      '        self.reorder_at = reorder_at',
      '',
      '    def needs_reorder(self):',
      '        return self.quantity <= self.reorder_at',
      '',
      '',
      'class Inventory:',
      '    def __init__(self, items):',
      '        self.items = items',
      '',
      '    def low_stock(self):',
      '        return [item for item in self.items if item.needs_reorder()]',
      '',
      '',
      'inv = Inventory([Item("LAMP-1", "Desk lamp", 3, 5), Item("MUG-2", "Mug", 40, 10)])',
      'for item in inv.low_stock():',
      '    print(item.sku, item.name, item.quantity)',
      '',
    ].join('\n'),
  },

  // ── C ──────────────────────────────────────────────────────────────────────
  {
    id: 'c-average-bug',
    languageId: 'c',
    title: 'Array average (off-by-one hunt)',
    level: 'beginner',
    problem:
      'This program averages an int array. It compiles in principle but the loop has an off-by-one bug and the accumulator is uninitialised. Find both problems, explain the undefined behaviour risk, and show a corrected version.',
    code: [
      '#include <stdio.h>',
      '',
      'int main(void) {',
      '    int values[] = { 4, 8, 15, 16, 23, 42 };',
      '    int count = 6;',
      '    int sum;',
      '    for (int i = 0; i <= count; i++) {',
      '        sum += values[i];',
      '    }',
      '    double average = (double)sum / count;',
      '    printf("average = %.2f\\n", average);',
      '    return 0;',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'c-reverse-pointers',
    languageId: 'c',
    title: 'String reverse with pointers',
    level: 'intermediate',
    problem:
      'Reverse a string in place using two pointers. Explain how the pointers move, what happens with an empty string, and why the terminating null byte must not be swapped. Point out any undefined behaviour in the starter.',
    code: [
      '#include <stdio.h>',
      '#include <string.h>',
      '',
      'void reverse_in_place(char *s) {',
      '    char *left = s;',
      '    char *right = s + strlen(s) - 1;',
      '    while (left < right) {',
      '        char tmp = *left;',
      '        *left = *right;',
      '        *right = tmp;',
      '        left++;',
      '        right--;',
      '    }',
      '}',
      '',
      'int main(void) {',
      '    char word[] = "playground";',
      '    reverse_in_place(word);',
      '    printf("%s\\n", word);',
      '    return 0;',
      '}',
      '',
    ].join('\n'),
  },

  // ── C++ ────────────────────────────────────────────────────────────────────
  {
    id: 'cpp-rectangle-class',
    languageId: 'cpp',
    title: 'Rectangle class and the rule of three',
    level: 'intermediate',
    problem:
      'Review this Rectangle class: constructors, a member function and ownership. It currently stores a dynamically allocated label and copies it with the default copy constructor — explain the double-free risk and rewrite it to follow the rule of three (or better, use std::string).',
    code: [
      '#include <cstring>',
      '#include <iostream>',
      '',
      'class Rectangle {',
      'public:',
      '    Rectangle(double w, double h, const char* label)',
      '        : width_(w), height_(h) {',
      '        label_ = new char[std::strlen(label) + 1];',
      '        std::strcpy(label_, label);',
      '    }',
      '    ~Rectangle() { delete[] label_; }',
      '',
      '    double area() const { return width_ * height_; }',
      '',
      'private:',
      '    double width_;',
      '    double height_;',
      '    char* label_;',
      '};',
      '',
      'int main() {',
      '    Rectangle a(3.0, 4.0, "garden bed");',
      '    Rectangle b = a;',
      '    std::cout << b.area() << "\\n";',
      '    return 0;',
      '}',
      '',
    ].join('\n'),
  },

  // ── Java ───────────────────────────────────────────────────────────────────
  {
    id: 'java-word-count',
    languageId: 'java',
    title: 'HashMap word count',
    level: 'intermediate',
    problem:
      'Count words with a HashMap and print the entries sorted by count (highest first). Explain the collections used, the comparator, and how you would switch to a TreeMap or streams.',
    code: [
      'import java.util.*;',
      '',
      'public class WordCount {',
      '    public static void main(String[] args) {',
      '        String text = "the fox runs the dog barks the fox hides";',
      '        Map<String, Integer> counts = new HashMap<>();',
      '        for (String word : text.split(" ")) {',
      '            counts.merge(word, 1, Integer::sum);',
      '        }',
      '        counts.entrySet().stream()',
      '            .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())',
      '            .forEach(e -> System.out.println(e.getKey() + " -> " + e.getValue()));',
      '    }',
      '}',
      '',
    ].join('\n'),
  },

  // ── JavaScript ─────────────────────────────────────────────────────────────
  {
    id: 'js-array-pipeline',
    languageId: 'javascript',
    title: 'Array pipeline: filter / map / reduce',
    level: 'beginner',
    problem:
      'From the orders array, keep the delivered orders, map them to their totals and print the sum with reduce. Explain each step and what happens with an empty input.',
    code: [
      'const orders = [',
      '  { id: 1, status: "delivered", items: [12.5, 3.2] },',
      '  { id: 2, status: "pending", items: [7.0] },',
      '  { id: 3, status: "delivered", items: [41.0, 7.5] },',
      '];',
      '',
      'const totals = orders',
      '  .filter((order) => order.status === "delivered")',
      '  .map((order) => order.items.reduce((sum, price) => sum + price, 0));',
      '',
      'const grandTotal = totals.reduce((sum, total) => sum + total, 0);',
      'console.log("totals:", totals, "grand:", grandTotal.toFixed(2));',
      '',
    ].join('\n'),
  },
  {
    id: 'js-async-sequential',
    languageId: 'javascript',
    title: 'Async: sequential vs parallel promises',
    level: 'intermediate',
    problem:
      'This code fetches three chunks one after another. Explain the difference from Promise.all, rewrite it to run in parallel, and describe how errors would surface in each version. Do not actually run any network calls — reason about the code.',
    code: [
      'async function loadChunks(ids) {',
      '  const results = [];',
      '  for (const id of ids) {',
      '    const res = await fakeFetch(id);',
      '    results.push(res);',
      '  }',
      '  return results;',
      '}',
      '',
      'function fakeFetch(id) {',
      '  return new Promise((resolve) => resolve({ id, data: "chunk-" + id }));',
      '}',
      '',
      'loadChunks(["a", "b", "c"]).then((chunks) => console.log(chunks.length, "chunks"));',
      '',
    ].join('\n'),
  },

  // ── TypeScript ─────────────────────────────────────────────────────────────
  {
    id: 'ts-narrowing',
    languageId: 'typescript',
    title: 'Typed API responses and narrowing',
    level: 'intermediate',
    problem:
      'Review this typed loader: the discriminated union, the narrowing in handle, and the exhaustiveness check. Explain what the never branch guarantees and how the types would catch a new variant being added.',
    code: [
      'type ApiResult =',
      '  | { kind: "ok"; data: string[] }',
      '  | { kind: "error"; message: string; retryable: boolean };',
      '',
      'function handle(result: ApiResult): string {',
      '  switch (result.kind) {',
      '    case "ok":',
      '      return "loaded " + result.data.length + " rows";',
      '    case "error":',
      '      return (result.retryable ? "retry later: " : "failed: ") + result.message;',
      '    default: {',
      '      const exhaustive: never = result;',
      '      return exhaustive;',
      '    }',
      '  }',
      '}',
      '',
      'const sample: ApiResult = { kind: "ok", data: ["a", "b"] };',
      'console.log(handle(sample));',
      '',
    ].join('\n'),
  },

  // ── SQL ────────────────────────────────────────────────────────────────────
  {
    id: 'sql-top-customers',
    languageId: 'sql',
    title: 'Top customers by revenue (GROUP BY / HAVING)',
    level: 'beginner',
    problem:
      'Using the sample shop schema, list each customer with their total revenue (sum of quantity * price) sorted highest first, keeping only customers above 100 in total. Explain every clause and predict the result — the query is not executed here.',
    code: [
      'SELECT c.name,',
      '       SUM(oi.quantity * p.price) AS revenue',
      'FROM customers c',
      'JOIN orders o ON o.customer_id = c.id',
      'JOIN order_items oi ON oi.order_id = o.id',
      'JOIN products p ON p.id = oi.product_id',
      'GROUP BY c.name',
      'HAVING SUM(oi.quantity * p.price) > 100',
      'ORDER BY revenue DESC;',
      '',
    ].join('\n'),
  },
  {
    id: 'sql-never-ordered',
    languageId: 'sql',
    title: 'Products never ordered (LEFT JOIN / NULL)',
    level: 'intermediate',
    problem:
      'Find products that were never ordered using a LEFT JOIN and a NULL check. Explain why NOT IN with a nullable column is a trap, and compare the alternatives (NOT EXISTS, LEFT JOIN).',
    code: [
      'SELECT p.name',
      'FROM products p',
      'LEFT JOIN order_items oi ON oi.product_id = p.id',
      'WHERE oi.product_id IS NULL;',
      '',
    ].join('\n'),
  },
  {
    id: 'sql-monthly-window',
    languageId: 'sql',
    title: 'Monthly revenue with window functions',
    level: 'advanced',
    problem:
      'Per calendar month, show total revenue and the running (cumulative) total across months using SUM() OVER, plus each month rank by revenue. Explain the frame clause and how the result would differ with PARTITION BY.',
    code: [
      'SELECT strftime("%Y-%m", o.order_date) AS month,',
      '       SUM(oi.quantity * p.price) AS revenue,',
      '       SUM(SUM(oi.quantity * p.price)) OVER (ORDER BY strftime("%Y-%m", o.order_date)) AS running_total,',
      '       RANK() OVER (ORDER BY SUM(oi.quantity * p.price) DESC) AS revenue_rank',
      'FROM orders o',
      'JOIN order_items oi ON oi.order_id = o.id',
      'JOIN products p ON p.id = oi.product_id',
      'GROUP BY month',
      'ORDER BY month;',
      '',
    ].join('\n'),
  },

  // ── HTML / CSS ─────────────────────────────────────────────────────────────
  {
    id: 'html-signup-form',
    languageId: 'html',
    title: 'Accessible signup form',
    level: 'beginner',
    problem:
      'Review this signup form for accessibility: labels, input types, autocomplete, error wiring and keyboard use. Explain what a screen reader announces and suggest concrete improvements. The form is not rendered here.',
    code: [
      '<form action="/signup" method="post">',
      '  <div>',
      '    <label for="email">Email</label>',
      '    <input id="email" type="email" name="email" required>',
      '  </div>',
      '  <div>',
      '    <label for="password">Password</label>',
      '    <input id="password" type="password" name="password" minlength="10" required>',
      '  </div>',
      '  <p id="hint">Use at least 10 characters with one number.</p>',
      '  <button type="submit">Create account</button>',
      '</form>',
      '',
    ].join('\n'),
  },
  {
    id: 'css-card-grid',
    languageId: 'css',
    title: 'Responsive card grid',
    level: 'intermediate',
    problem:
      'Explain this responsive card grid: auto-fit vs auto-fill, the minmax track sizing, gap handling and how it degrades on narrow screens. Suggest one improvement for very wide screens.',
    code: [
      '.card-grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));',
      '  gap: 1rem;',
      '}',
      '',
      '.card {',
      '  border: 1px solid hsl(0 0% 80% / 0.6);',
      '  border-radius: 0.5rem;',
      '  padding: 1rem;',
      '}',
      '',
      '@media (max-width: 480px) {',
      '  .card-grid { grid-template-columns: 1fr; }',
      '}',
      '',
    ].join('\n'),
  },

  // ── Go / Rust ──────────────────────────────────────────────────────────────
  {
    id: 'go-race-counter',
    languageId: 'go',
    title: 'Fix the unsynchronised counter',
    level: 'intermediate',
    problem:
      'This worker pool increments a shared counter from several goroutines without synchronisation — a data race. Find the race, explain why it is nondeterministic, and fix it with a mutex or channel. The code is analysed, not run.',
    code: [
      'package main',
      '',
      'import (',
      '    "fmt"',
      '    "sync"',
      ')',
      '',
      'func main() {',
      '    counter := 0',
      '    var wg sync.WaitGroup',
      '    for i := 0; i < 10; i++ {',
      '        wg.Add(1)',
      '        go func() {',
      '            defer wg.Done()',
      '            counter++',
      '        }()',
      '    }',
      '    wg.Wait()',
      '    fmt.Println("counter:", counter)',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'rust-borrow',
    languageId: 'rust',
    title: 'Fix the borrow-checker errors',
    level: 'intermediate',
    problem:
      'This function pushes into a vector while iterating it — the compiler would reject it. Explain the ownership rule being violated, then rewrite it safely (e.g. collect first, or use indices). Not compiled here; reason from the code.',
    code: [
      'fn duplicate_evens(values: &mut Vec<i32>) {',
      '    for v in values.iter() {',
      '        if v % 2 == 0 {',
      '            values.push(*v);',
      '        }',
      '    }',
      '}',
      '',
      'fn main() {',
      '    let mut data = vec![1, 2, 3, 4];',
      '    duplicate_evens(&mut data);',
      '    println!("{:?}", data);',
      '}',
      '',
    ].join('\n'),
  },

  // ── PHP / C# / Bash / PowerShell ───────────────────────────────────────────
  {
    id: 'php-array-cleanup',
    languageId: 'php',
    title: 'Clean and summarise an array',
    level: 'beginner',
    problem:
      'Trim, drop empties and sum the amounts with array_filter / array_map / array_sum. Explain the callbacks and how array_values avoids holes in the result.',
    code: [
      '<?php',
      '$raw = [" 12.50 ", "", "7.00", " 3.25", "0"];',
      '',
      '$clean = array_map("trim", $raw);',
      '$nonEmpty = array_filter($clean, fn($value) => $value !== "" && (float)$value > 0);',
      '$total = array_sum(array_map("floatval", $nonEmpty));',
      '',
      'echo "items: " . count($nonEmpty) . ", total: " . $total;',
      '',
    ].join('\n'),
  },
  {
    id: 'cs-list-filter',
    languageId: 'csharp',
    title: 'Filter and project a list',
    level: 'beginner',
    problem:
      'Explain the Where/Select pipeline, the lambda captures and deferred execution. Suggest a version that also groups by category, and note any nullable pitfalls.',
    code: [
      'using System;',
      'using System.Collections.Generic;',
      'using System.Linq;',
      '',
      'class Program {',
      '    static void Main() {',
      '        var items = new List<(string Name, string Category, double Price)> {',
      '            ("Desk lamp", "Home", 24.5),',
      '            ("Notebook", "Office", 3.2),',
      '            ("Monitor", "Electronics", 139.0),',
      '        };',
      '',
      '        var affordable = items',
      '            .Where(i => i.Price < 50)',
      '            .Select(i => i.Name + " (" + i.Category + ")");',
      '',
      '        foreach (var label in affordable) Console.WriteLine(label);',
      '    }',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'bash-log-parse',
    languageId: 'bash',
    title: 'Parse an access log for top IPs',
    level: 'beginner',
    problem:
      'Explain this pipeline step by step (cut, sort, uniq, head). Then add a step that also shows the HTTP status distribution. Do not run it — analyse the script.',
    code: [
      '#!/bin/bash',
      '# Summarise the top client IPs in an access log.',
      'LOG_FILE="access.log"',
      '',
      'if [ ! -f "$LOG_FILE" ]; then',
      '  echo "missing $LOG_FILE" >&2',
      '  exit 1',
      'fi',
      '',
      'cut -d" " -f1 "$LOG_FILE" \\',
      '  | sort \\',
      '  | uniq -c \\',
      '  | sort -nr \\',
      '  | head -n 5',
      '',
    ].join('\n'),
  },
  {
    id: 'ps-inventory',
    languageId: 'powershell',
    title: 'Inventory function returning objects',
    level: 'beginner',
    problem:
      'Review this function: parameter validation, pipeline-friendly object output and the difference from returning formatted text. Suggest improvements for error handling and a -Detailed switch.',
    code: [
      'function Get-FolderInventory {',
      '    [CmdletBinding()]',
      '    param(',
      '        [Parameter(Mandatory = $true)]',
      '        [string]$Path',
      '    )',
      '',
      '    Get-ChildItem -Path $Path -File | ForEach-Object {',
      '        [pscustomobject]@{',
      '            Name     = $_.Name',
      '            SizeKB   = [math]::Round($_.Length / 1KB, 1)',
      '            Modified = $_.LastWriteTime',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n'),
  },

  // ── JSON / YAML ────────────────────────────────────────────────────────────
  {
    id: 'json-config-review',
    languageId: 'json',
    title: 'Nested configuration review',
    level: 'beginner',
    problem:
      'Review this configuration: naming consistency, missing fields, arrays of objects and anything ambiguous for a human reading it later. Suggest a tightened version with the same behaviour.',
    code: [
      '{',
      '  "service": "checkout",',
      '  "port": 8080,',
      '  "environment": "staging",',
      '  "retries": { "count": 3, "backoff_ms": 250 },',
      '  "features": ["fast-pay", "gift-wrap", "fraud-check-v2"],',
      '  "database": { "host": "localhost", "name": "orders", "pool_size": 5 }',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'yaml-ci-job',
    languageId: 'yaml',
    title: 'Add a CI job in YAML',
    level: 'intermediate',
    problem:
      'Review this pipeline definition: indentation rules that matter, how matrices expand, and how to add a job that runs only on tags. Point out anything that would silently misbehave.',
    code: [
      'name: build',
      'on:',
      '  push:',
      '    branches: [main]',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    strategy:',
      '      matrix:',
      '        python: ["3.11", "3.12"]',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - name: Run tests',
      '        run: python -m pytest',
      '',
    ].join('\n'),
  },
]

const STARTERS_BY_LANGUAGE = new Map<string, StarterExercise[]>()
for (const s of STARTERS) {
  const list = STARTERS_BY_LANGUAGE.get(s.languageId) ?? []
  list.push(s)
  STARTERS_BY_LANGUAGE.set(s.languageId, list)
}

export function startersFor(languageId: string): StarterExercise[] {
  return STARTERS_BY_LANGUAGE.get(languageId) ?? []
}

export function starterById(id: string): StarterExercise | undefined {
  return STARTERS.find((s) => s.id === id)
}

/** The starter a fresh practice for this language opens with. */
export function firstStarter(languageId: string): StarterExercise | undefined {
  return startersFor(languageId)[0]
}

// ── SQL sample schema (static text — no database is created) ────────────────
export interface SqlSampleTable {
  name: string
  columns: Array<{ name: string; type: string; note?: string }>
  rows: Array<Array<string | number>>
}

export interface SqlSampleSchema {
  id: string
  label: string
  note: string
  tables: SqlSampleTable[]
}

export const SQL_SAMPLE_SCHEMA: SqlSampleSchema = {
  id: 'shop',
  label: 'Sample shop schema',
  note: 'Sample data shipped with the playground. It exists as text only — no database is created and queries are never executed.',
  tables: [
    {
      name: 'customers',
      columns: [
        { name: 'id', type: 'INTEGER', note: 'primary key' },
        { name: 'name', type: 'TEXT' },
        { name: 'city', type: 'TEXT' },
        { name: 'signup_date', type: 'TEXT' },
      ],
      rows: [
        [1, 'Ana', 'Lisbon', '2024-01-12'],
        [2, 'Bo', 'Oslo', '2024-02-03'],
        [3, 'Chen', 'Taipei', '2024-02-20'],
        [4, 'Dara', 'Nairobi', '2024-03-05'],
        [5, 'Eli', 'Lima', '2024-03-22'],
      ],
    },
    {
      name: 'products',
      columns: [
        { name: 'id', type: 'INTEGER', note: 'primary key' },
        { name: 'name', type: 'TEXT' },
        { name: 'price', type: 'REAL' },
        { name: 'category', type: 'TEXT' },
      ],
      rows: [
        [1, 'Desk lamp', 24.5, 'Home'],
        [2, 'Notebook', 3.2, 'Office'],
        [3, 'Keyboard', 41.0, 'Electronics'],
        [4, 'Mug', 7.5, 'Home'],
        [5, 'Monitor', 139.0, 'Electronics'],
      ],
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'INTEGER', note: 'primary key' },
        { name: 'customer_id', type: 'INTEGER', note: '→ customers.id' },
        { name: 'order_date', type: 'TEXT' },
      ],
      rows: [
        [1001, 1, '2024-04-01'],
        [1002, 1, '2024-04-15'],
        [1003, 2, '2024-04-16'],
        [1004, 3, '2024-05-02'],
        [1005, 3, '2024-05-19'],
        [1006, 5, '2024-05-21'],
      ],
    },
    {
      name: 'order_items',
      columns: [
        { name: 'order_id', type: 'INTEGER', note: '→ orders.id' },
        { name: 'product_id', type: 'INTEGER', note: '→ products.id' },
        { name: 'quantity', type: 'INTEGER' },
      ],
      rows: [
        [1001, 1, 2],
        [1001, 4, 4],
        [1002, 3, 1],
        [1003, 2, 10],
        [1004, 5, 1],
        [1005, 3, 1],
        [1005, 4, 2],
        [1006, 2, 3],
      ],
    },
  ],
}

/** CREATE TABLE text for the schema panel and the analysis prompt. */
export function schemaDdlText(schema: SqlSampleSchema = SQL_SAMPLE_SCHEMA): string {
  return schema.tables
    .map((t) => {
      const cols = t.columns.map((c) => (c.note ? `${c.name} ${c.type} -- ${c.note}` : `${c.name} ${c.type}`))
      return `CREATE TABLE ${t.name} (\n  ${cols.join(',\n  ')}\n);`
    })
    .join('\n\n')
}

/** Compact text dump of one table's rows (used in prompts only). */
export function schemaTableDump(table: SqlSampleTable, limit = 12): string {
  const header = table.columns.map((c) => c.name).join(' | ')
  const rows = table.rows.slice(0, limit).map((r) => r.map((v) => String(v)).join(' | '))
  return [header, ...rows].join('\n')
}

// ── Excel sample workbooks (raw cell text, formulas uncomputed) ─────────────
export interface SampleWorkbook {
  id: string
  label: string
  problem: string
  sheet: ExcelSheet
}

export const SAMPLE_WORKBOOKS: SampleWorkbook[] = [
  {
    id: 'sales-q1',
    label: 'Sales Q1 (sample)',
    problem:
      'This sheet tracks Q1 sales per rep. The Revenue column multiplies Units by Price, and the summary rows total the revenue, find the best rep with XLOOKUP and compare against the targets. Explain the formulas, look for likely errors, and suggest a correction where needed.',
    sheet: {
      name: 'Sales Q1',
      columns: 6,
      rows: 14,
      cells: {
        A1: 'Region',
        B1: 'Rep',
        C1: 'Units',
        D1: 'Price',
        E1: 'Revenue',
        F1: 'Target',
        A2: 'West',
        B2: 'Ana',
        C2: '12',
        D2: '19.5',
        E2: '=C2*D2',
        F2: '250',
        A3: 'North',
        B3: 'Bo',
        C3: '8',
        D3: '24',
        E3: '=C3*D3',
        F3: '200',
        A4: 'East',
        B4: 'Chen',
        C4: '31',
        D4: '7.25',
        E4: '=C4*D4',
        F4: '180',
        A5: 'South',
        B5: 'Dara',
        C5: '15',
        D5: '13',
        E5: '=C5*D5',
        F5: '220',
        A6: 'West',
        B6: 'Eli',
        C6: '21',
        D6: '9.5',
        E6: '=C6*D6',
        F6: '150',
        A8: 'Total revenue',
        B8: '=SUM(E2:E6)',
        A9: 'Best rep',
        B9: '=XLOOKUP(MAX(E2:E6),E2:E6,B2:B2)',
        A10: 'On track?',
        B10: '=IF(B8>=SUM(F2:F6),"On track","Behind")',
        A12: 'Note',
        B12: 'Targets are quarterly; prices are average sale prices.',
      },
    },
  },
  {
    id: 'budget-planner',
    label: 'Budget planner (sample)',
    problem:
      'A small monthly budget. Balance subtracts expenses from income, Status flags overspending and the summary totals the quarter. Explain relative vs absolute references, check the IF logic and suggest improvements (for example a savings row using an absolute reference to the quarter total).',
    sheet: {
      name: 'Budget',
      columns: 5,
      rows: 12,
      cells: {
        A1: 'Month',
        B1: 'Income',
        C1: 'Expenses',
        D1: 'Balance',
        E1: 'Status',
        A2: 'January',
        B2: '3200',
        C2: '2450',
        D2: '=B2-C2',
        E2: '=IF(D2<0,"Over","OK")',
        A3: 'February',
        B3: '3200',
        C3: '3380',
        D3: '=B3-C3',
        E3: '=IF(D3<0,"Over","OK")',
        A4: 'March',
        B4: '3350',
        C4: '2905',
        D4: '=B4-C4',
        E4: '=IF(D4<0,"Over","OK")',
        A6: 'Quarter income',
        B6: '=SUM(B2:B4)',
        A7: 'Quarter expenses',
        B7: '=SUM(C2:C4)',
        A8: 'Quarter balance',
        B8: '=B6-B7',
        A10: 'Savings (10% of income)',
        B10: '=$B$6*0.1',
        A11: 'Days in January',
        B11: '=DATE(2025,2,1)-DATE(2025,1,1)',
      },
    },
  },
]

export function workbookById(id: string): SampleWorkbook | undefined {
  return SAMPLE_WORKBOOKS.find((w) => w.id === id)
}

/** Bounded TSV dump of a sheet for the analysis prompt (raw text only). */
export function sheetDump(sheet: ExcelSheet, maxRows = 40, maxCols = 16): string {
  const lines: string[] = []
  const cols = Math.min(sheet.columns, maxCols)
  const rows = Math.min(sheet.rows, maxRows)
  const letter = (i: number) => String.fromCharCode(65 + i)
  lines.push(['', ...Array.from({ length: cols }, (_, i) => letter(i))].join('\t'))
  for (let r = 1; r <= rows; r++) {
    const cellsInRow: string[] = []
    let used = false
    for (let c = 0; c < cols; c++) {
      const v = sheet.cells[`${letter(c)}${r}`] ?? ''
      if (v) used = true
      cellsInRow.push(v)
    }
    if (used) lines.push([String(r), ...cellsInRow].join('\t'))
  }
  return lines.join('\n')
}
