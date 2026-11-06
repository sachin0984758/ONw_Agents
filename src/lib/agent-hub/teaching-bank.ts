// ── Teaching bank: deterministic, app-owned lesson content ───────────────────
// The Teaching Agent must not depend on an 8–12B local model inventing an
// entire methodology on every request. This module owns the *structure* and a
// small, real content bank: topic metadata, prerequisites, key definitions,
// worked examples with expected output, common mistakes, revision facts,
// quizzes (with scoring keys) and progressive exercises.
//
// The model is used to ENRICH the prose; when it is unavailable the lesson is
// still complete and correct because everything here is deterministic data.
//
// Pure data + types only — no fs, no fetch, no React. Safe on client + server.

export type SubjectId =
  | 'python'
  | 'sql'
  | 'c'
  | 'excel'
  | 'linux'
  | 'electronics'
  | 'ml'
  | 'aptitude'
  | 'generic'

export type Level = 'beginner' | 'intermediate' | 'advanced'

export type LessonSectionKind =
  | 'intro'
  | 'prerequisites'
  | 'concepts'
  | 'visual'
  | 'examples'
  | 'mistakes'
  | 'practice'
  | 'project'
  | 'revision'

export type ExerciseKind =
  | 'multiple-choice'
  | 'predict-output'
  | 'find-error'
  | 'write-code'
  | 'complete-code'
  | 'explain-result'
  | 'scenario'

export interface QuizQuestion {
  id: string
  /** Difficulty of the question. */
  level: Level
  /** Question styles, mirroring the progressive-practice taxonomy. */
  kind: ExerciseKind
  prompt: string
  /** Present for multiple-choice / predict-output-with-options. */
  options?: string[]
  /** Index into `options` (multiple-choice) — the scoring key. */
  answerIndex?: number
  /** Free-text model answer for non-MCQ questions. */
  answer?: string
  /** Shown after answering: why the answer is right/wrong. */
  explanation: string
  hint?: string
}

export interface Exercise {
  id: string
  level: Level
  kind: ExerciseKind
  prompt: string
  hint?: string
  /** Solution — never shown until the learner asks for it. */
  solution: string
  language?: string
  /** Optional starter/incorrect code the exercise refers to. */
  code?: string
  /**
   * Multiple-choice options + key. When present the exercise can be graded
   * deterministically (see `gradeExercise`); the solution stays hidden until
   * the learner asks for it, exactly like a free-form exercise.
   */
  options?: string[]
  answerIndex?: number
  /**
   * An exact, unambiguous expected result (e.g. a predicted printed value).
   * When present the exercise can be graded deterministically offline.
   */
  expected?: string
}

export interface LessonDiagram {
  format: 'flow' | 'ascii'
  ascii?: string
  nodes?: Array<{ id: string; label: string }>
  edges?: Array<{ from: string; to: string; label?: string }>
  caption?: string
}

export interface TopicContent {
  id: string
  subject: SubjectId
  label: string
  /** Matched against the user's request to pick this topic. */
  keywords: RegExp
  /** Prerequisite topic ids (short reminder, not a full re-teach). */
  prereqs: string[]
  /** Recommended next topic ids. */
  next: string[]
  /** What it is / why it exists / where it is used / intended outcome. */
  intro: string
  /** Concept name → plain-language definition. */
  keyIdeas: Array<{ term: string; definition: string }>
  /** A concrete, simple→complex worked example. */
  example: {
    language: string
    code: string
    output?: string
    steps: string[]
  }
  /** Realistic mistakes with cause and fix. */
  mistakes: Array<{ mistake: string; cause: string; fix: string; code?: string }>
  diagram: LessonDiagram
  revision: Array<{ label: string; value: string }>
  quiz: QuizQuestion[]
  exercises: Exercise[]
  /** Optional proportional mini-project. */
  project?: { objective: string; requirements: string[]; steps: string[]; expected: string }
}

// ── Topic bank ───────────────────────────────────────────────────────────────
// Compact but genuine: each topic teaches, demonstrates, assesses and revises.

const PYTHON_OOP: TopicContent = {
  id: 'python-oop',
  subject: 'python',
  label: 'Python OOP (classes, objects, inheritance, polymorphism)',
  keywords: /\b(oops?|oop|object[- ]oriented|class(es)?|objects?|inheritance|polymorphism|encapsulation|abstraction)\b/i,
  prereqs: ['python-functions'],
  next: ['python-exceptions'],
  intro:
    'Object-oriented programming (OOP) groups data and the behaviour that acts on it into a single unit: an object. ' +
    'It exists so large programs can stay modular, reusable and easier to reason about than a pile of loose functions. ' +
    'Python builds this on **classes** (blueprints) and **objects** (instances). ' +
    'By the end you should be able to define a class, create objects, and explain inheritance and polymorphism with your own example.',
  keyIdeas: [
    { term: 'Class', definition: 'A blueprint that defines attributes (data) and methods (behaviour) for the objects created from it.' },
    { term: 'Object / instance', definition: 'A concrete value built from a class, holding its own copy of instance attributes.' },
    { term: 'Attribute vs method', definition: 'An attribute is stored data (self.name); a method is a function defined on the class and called on an object (obj.greet()).' },
    { term: 'self', definition: 'The reference to the current object, passed automatically as the first argument of every instance method.' },
    { term: 'Inheritance', definition: 'A child class acquires attributes/methods of a parent class, enabling reuse and hierarchy.' },
    { term: 'Polymorphism', definition: '"Same operation, different behaviour" — objects of different classes answer the same method call in their own way.' },
  ],
  example: {
    language: 'python',
    code:
      'class Animal:\n' +
      '    species = "Animal"          # class attribute (shared)\n\n' +
      '    def __init__(self, name):   # constructor\n' +
      '        self.name = name        # instance attribute (unique)\n\n' +
      '    def sound(self):            # method to be overridden\n' +
      '        return "..."\n\n\n' +
      'class Dog(Animal):              # inheritance\n' +
      '    def sound(self):            # polymorphism (override)\n' +
      '        return "Woof"\n\n\n' +
      'd = Dog("Rex")\n' +
      'print(d.name, d.species, d.sound())\n',
    output: 'Rex Animal Woof',
    steps: [
      'class Animal defines the shared blueprint; species is stored once, on the class.',
      '__init__ runs automatically when an object is created and stores name on that object.',
      'class Dog(Animal) inherits species and gets its own sound().',
      'd.sound() dispatches to Dog.sound, not Animal.sound — runtime polymorphism.',
      'd.name reads the instance attribute; d.species reads the inherited class attribute.',
    ],
  },
  mistakes: [
    {
      mistake: 'Calling a method without self, or forgetting self in the definition.',
      cause: 'Instance methods always receive the object as the first parameter.',
      fix: 'Define `def greet(self):` and call it as `obj.greet()`.',
      code: 'def greet():      # wrong\ndef greet(self):  # right',
    },
    {
      mistake: 'Confusing a class attribute with an instance attribute.',
      cause: 'Assigning `self.x = ...` creates an instance attribute that shadows the class one.',
      fix: 'Use a class attribute for values shared by all objects; set `self.x` for per-object data.',
    },
    {
      mistake: 'Mutating a mutable class attribute by accident.',
      cause: 'Lists/dicts on the class are shared; `obj.items.append(...)` changes every instance.',
      fix: 'Initialise mutable defaults inside __init__ (`self.items = []`).',
    },
  ],
  diagram: {
    format: 'flow',
    caption: 'Dog inherits from Animal, then overrides sound() — a single call dispatches to the right method.',
    nodes: [
      { id: 'animal', label: 'Animal (sound → "...")' },
      { id: 'dog', label: 'Dog (sound → "Woof")' },
      { id: 'call', label: 'd.sound()' },
    ],
    edges: [
      { from: 'dog', to: 'animal', label: 'inherits' },
      { from: 'call', to: 'dog', label: 'dispatches' },
    ],
  },
  revision: [
    { label: 'class / object', value: 'class = blueprint; object = instance of it' },
    { label: 'constructor', value: 'def __init__(self, ...)' },
    { label: 'instance attr', value: 'self.x = ... (unique per object)' },
    { label: 'class attr', value: 'name = ... on the class (shared)' },
    { label: 'inheritance', value: 'class Child(Parent): ...' },
    { label: 'polymorphism', value: 'child overrides a parent method' },
  ],
  quiz: [
    {
      id: 'py-oop-q1',
      level: 'beginner',
      kind: 'multiple-choice',
      prompt: 'Which statement about `self` is correct?',
      options: [
        'It is a reserved keyword that must be named self.',
        'It is the first parameter of an instance method and refers to the current object.',
        'It is required only in __init__.',
        'It creates a new object.',
      ],
      answerIndex: 1,
      explanation:
        'self is an ordinary parameter name (by convention `self`, but you could call it anything) that receives the current instance automatically.',
    },
    {
      id: 'py-oop-q2',
      level: 'intermediate',
      kind: 'predict-output',
      prompt: 'What does this print?\n\nclass A:\n    x = 1\nclass B(A):\n    pass\nprint(B.x)',
      options: ['1', 'NameError', 'None', 'Error: x not defined'],
      answerIndex: 0,
      explanation: 'B inherits from A, so B.x resolves to the inherited class attribute 1.',
    },
    {
      id: 'py-oop-q3',
      level: 'advanced',
      kind: 'find-error',
      prompt: 'Why does `Pet("Tom").speak()` fail?\n\nclass Pet:\n    def __init__(name):\n        self.name = name\n    def speak(self):\n        return self.name',
      answer: 'The constructor is missing `self` in its parameter list.',
      explanation: '__init__ is an instance method, so its first parameter must be self: `def __init__(self, name):`.',
    },
  ],
  exercises: [
    {
      id: 'py-oop-e1',
      level: 'beginner',
      kind: 'write-code',
      prompt: 'Create a class `Book` with `title` and `author`, and a method `describe()` returning "<title> by <author>".',
      language: 'python',
      hint: 'Store both values in __init__ using self.',
      solution: 'class Book:\n    def __init__(self, title, author):\n        self.title = title\n        self.author = author\n\n    def describe(self):\n        return f"{self.title} by {self.author}"',
    },
    {
      id: 'py-oop-e2',
      level: 'intermediate',
      kind: 'write-code',
      prompt: 'Write `Employee` and `Manager(Employee)` where Manager adds a `bonus`, and `total_salary()` adds salary + bonus.',
      language: 'python',
      hint: 'Call super().__init__(salary) in Manager.',
      solution: 'class Employee:\n    def __init__(self, salary):\n        self.salary = salary\n    def total_salary(self):\n        return self.salary\n\nclass Manager(Employee):\n    def __init__(self, salary, bonus):\n        super().__init__(salary)\n        self.bonus = bonus\n    def total_salary(self):\n        return self.salary + self.bonus',
    },
    {
      id: 'py-oop-e3',
      level: 'advanced',
      kind: 'scenario',
      prompt: 'Design `Shape` (abstract), `Circle` and `Rectangle`, each with an `area()`. Sum the areas of a mixed list.',
      language: 'python',
      hint: 'Use ABC + @abstractmethod, then iterate and call area() polymorphically.',
      solution: 'from abc import ABC, abstractmethod\n\nclass Shape(ABC):\n    @abstractmethod\n    def area(self): ...\n\nclass Circle(Shape):\n    def __init__(self, r): self.r = r\n    def area(self): return round(3.14159 * self.r ** 2, 2)\n\nclass Rectangle(Shape):\n    def __init__(self, w, h): self.w, self.h = w, h\n    def area(self): return self.w * self.h\n\nprint(sum(s.area() for s in [Circle(2), Rectangle(3, 4)]))',
    },
    {
      id: 'py-oop-e4',
      level: 'intermediate',
      kind: 'multiple-choice',
      prompt: 'A child class `Dog` overrides `sound()` to return "Woof"; the parent `Animal.sound()` returns "...". What does `Dog("Rex").sound()` return?',
      options: ['"..." (the parent method)', '"Woof" (the override)', 'None', 'A TypeError'],
      answerIndex: 1,
      solution: 'It returns "Woof": polymorphism dispatches the call to Dog.sound, the most specific override.',
    },
  ],
  project: {
    objective: 'Build a tiny library-lending model.',
    requirements: ['A Book class with an available flag', 'A Library that can add, borrow and return books', 'Borrowing an already-issued book must be refused'],
    steps: ['Define Book', 'Define Library with a list', 'Implement borrow_book / return_book', 'Print a small scenario'],
    expected: 'Borrowing "Python" prints borrowed the first time and "already issued" the second.',
  },
}

const PYTHON_FUNCTIONS: TopicContent = {
  id: 'python-functions',
  subject: 'python',
  label: 'Python functions and scope',
  keywords: /\b(functions?|def\b|parameters?|arguments?|scope|return|lambda)\b/i,
  prereqs: [],
  next: ['python-oop'],
  intro:
    'A function packages a reusable block of work behind a name. It exists to avoid repetition and to give behaviour a clear interface. ' +
    'Functions are used everywhere in Python, and understanding parameters, return values and scope is the prerequisite for classes and larger programs.',
  keyIdeas: [
    { term: 'def', definition: 'Defines a function: `def name(params): ...`.' },
    { term: 'Parameter vs argument', definition: 'A parameter is the name in the definition; an argument is the value you pass in the call.' },
    { term: 'Return value', definition: '`return` hands a value back to the caller; without it the function returns None.' },
    { term: 'Scope', definition: 'Local names live inside the function; global names live in the module. Python looks up local → enclosing → global → built-in.' },
  ],
  example: {
    language: 'python',
    code:
      'def add(a, b=10):        # b has a default\n    return a + b\n\n' +
      'print(add(5))            # uses default\n' +
      'print(add(5, 1))         # overrides default\n\n' +
      'def stats(nums):\n    return min(nums), max(nums), sum(nums) / len(nums)\n\n' +
      'print(stats([4, 8, 6]))\n',
    output: '15\n6\n(4, 8, 6.0)',
    steps: [
      'add has one required parameter and one with a default.',
      'Calling add(5) uses the default b=10 → 15.',
      'Calling add(5, 1) passes b=1 → 6.',
      'stats returns a tuple; its values are unpacked when printed.',
    ],
  },
  mistakes: [
    { mistake: 'Mutable default argument.', cause: 'Defaults are evaluated once, not per call.', fix: 'Use None as the default and create the value inside.', code: 'def f(xs=None):\n    xs = xs or []' },
    { mistake: 'Forgetting return.', cause: 'The function then returns None silently.', fix: 'Add an explicit return, or accept None deliberately.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'A call passes arguments in, the body runs, and return sends a value back.',
    nodes: [{ id: 'call', label: 'call add(5)' }, { id: 'body', label: 'body runs' }, { id: 'ret', label: 'return 15' }],
    edges: [{ from: 'call', to: 'body' }, { from: 'body', to: 'ret' }],
  },
  revision: [
    { label: 'definition', value: 'def name(params): ...' },
    { label: 'default arg', value: 'def f(a, b=10)' },
    { label: 'return', value: 'return value (else None)' },
    { label: 'scope order', value: 'local → enclosing → global → built-in' },
  ],
  quiz: [
    {
      id: 'py-fn-q1',
      level: 'beginner',
      kind: 'predict-output',
      prompt: 'def f(x, y=2):\n    return x * y\nprint(f(3))',
      options: ['6', '32', 'Error', 'None'],
      answerIndex: 0,
      explanation: 'y uses its default 2, so 3 * 2 = 6.',
    },
    {
      id: 'py-fn-q2',
      level: 'intermediate',
      kind: 'multiple-choice',
      prompt: 'What does a function return if it has no return statement?',
      options: ['0', 'None', 'Nothing is printed', 'An error'],
      answerIndex: 1,
      explanation: 'Python functions implicitly return None.',
    },
  ],
  exercises: [
    { id: 'py-fn-e1', level: 'beginner', kind: 'write-code', prompt: 'Write `is_even(n)` returning True/False.', language: 'python', hint: 'Use the modulo operator.', solution: 'def is_even(n):\n    return n % 2 == 0' },
    { id: 'py-fn-e2', level: 'intermediate', kind: 'complete-code', prompt: 'Complete `def area(w, h=1): ...` so it returns w*h.', language: 'python', hint: 'One line.', solution: 'def area(w, h=1):\n    return w * h' },
    {
      id: 'py-fn-e3',
      level: 'beginner',
      kind: 'predict-output',
      prompt: 'What does this print?\n\ndef f(x, y=2):\n    return x * y\n\nprint(f(3))',
      expected: '6',
      hint: 'y keeps its default value when it is not passed.',
      solution: '6 — y defaults to 2, so 3 * 2 = 6.',
    },
  ],
}

const SQL_JOINS: TopicContent = {
  id: 'sql-joins',
  subject: 'sql',
  label: 'SQL joins',
  keywords: /\b(joins?|inner join|left join|right join|full (outer )?join|foreign key|relat(ional|ionship))\b/i,
  prereqs: ['sql-select'],
  next: ['sql-null-group'],
  intro:
    'A join combines rows from two or more tables using a related column. Joins exist because data is split across tables for normalisation ' +
    '(no duplicated customer data on every order). By the end you should be able to pick the right join type and predict its result set, including NULL behaviour.',
  keyIdeas: [
    { term: 'INNER JOIN', definition: 'Returns only rows that match in both tables.' },
    { term: 'LEFT JOIN', definition: 'Returns every row from the left table, with NULLs where the right side has no match.' },
    { term: 'RIGHT JOIN', definition: 'Mirror of LEFT: every row from the right table.' },
    { term: 'FULL OUTER JOIN', definition: 'Every row from both tables; unmatched sides become NULL.' },
    { term: 'Join condition', definition: 'The ON clause says how rows relate (usually a foreign key = primary key).' },
  ],
  example: {
    language: 'sql',
    code:
      '-- customers(id, name)\n' +
      '-- orders(id, customer_id, total)\n\n' +
      'SELECT c.name, o.total\n' +
      'FROM customers AS c\n' +
      'LEFT JOIN orders AS o ON o.customer_id = c.id\n' +
      'ORDER BY c.name;\n',
    output:
      'name | total\n' +
      '---- | -----\n' +
      'Ada  | 120\n' +
      'Bo   | NULL\n',
    steps: [
      'FROM customers picks the left table (all customers).',
      'LEFT JOIN keeps every customer even without orders.',
      'ON o.customer_id = c.id matches order rows to their customer.',
      'Bo has no order, so total is NULL — that is the whole point of a LEFT JOIN.',
    ],
  },
  mistakes: [
    { mistake: 'Using INNER JOIN when you need unmatched rows.', cause: 'INNER drops non-matching rows.', fix: 'Use LEFT JOIN to keep all left-side rows.' },
    { mistake: 'Filtering a LEFT JOIN in WHERE on the right table.', cause: '`WHERE o.total > 0` removes the NULL rows, turning it into an inner join.', fix: 'Put the condition in the ON clause, or accept the inner-join semantics deliberately.' },
    { mistake: 'Comparing NULL with =.', cause: '`col = NULL` is never true.', fix: 'Use `col IS NULL` / `col IS NOT NULL`.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'LEFT JOIN: every customer row survives; unmatched orders become NULL.',
    nodes: [
      { id: 'c', label: 'customers (Ada, Bo)' },
      { id: 'join', label: 'LEFT JOIN on customer_id = id' },
      { id: 'r', label: 'result (Ada 120, Bo NULL)' },
    ],
    edges: [{ from: 'c', to: 'join' }, { from: 'join', to: 'r' }],
  },
  revision: [
    { label: 'INNER', value: 'matches in both tables only' },
    { label: 'LEFT', value: 'all left rows + NULLs' },
    { label: 'RIGHT', value: 'all right rows + NULLs' },
    { label: 'FULL OUTER', value: 'all rows from both' },
    { label: 'NULL test', value: 'IS NULL / IS NOT NULL (never =)' },
  ],
  quiz: [
    {
      id: 'sql-j-q1',
      level: 'beginner',
      kind: 'multiple-choice',
      prompt: 'Which join returns all rows from the left table even when there is no match?',
      options: ['INNER JOIN', 'LEFT JOIN', 'CROSS JOIN', 'SELF JOIN'],
      answerIndex: 1,
      explanation: 'LEFT JOIN keeps every left row and fills the right side with NULL when there is no match.',
    },
    {
      id: 'sql-j-q2',
      level: 'intermediate',
      kind: 'predict-output',
      prompt: 'customers = {Ada, Bo}; orders has only Ada. How many rows does `customers LEFT JOIN orders` return?',
      options: ['1', '2', '0', '3'],
      answerIndex: 1,
      explanation: 'Both customers appear: Ada with her order, Bo with NULLs.',
    },
    {
      id: 'sql-j-q3',
      level: 'advanced',
      kind: 'find-error',
      prompt: 'Why does this drop customers with no orders?\nSELECT c.name, o.total FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE o.total > 0',
      answer: 'The WHERE filter on o.total removes the NULL rows produced by the LEFT JOIN.',
      explanation: 'Conditions on the right table belong in the ON clause if you want to keep unmatched left rows.',
    },
  ],
  exercises: [
    { id: 'sql-j-e1', level: 'beginner', kind: 'write-code', prompt: 'List every customer and their order totals, keeping customers without orders.', language: 'sql', hint: 'LEFT JOIN + IS NULL is not needed; just LEFT JOIN.', solution: 'SELECT c.name, o.total\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id;' },
    { id: 'sql-j-e2', level: 'intermediate', kind: 'scenario', prompt: 'Find customers who have never ordered.', language: 'sql', hint: 'LEFT JOIN then filter o.id IS NULL.', solution: 'SELECT c.name\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nWHERE o.id IS NULL;' },
    { id: 'sql-j-e3', level: 'advanced', kind: 'write-code', prompt: 'Total spend per customer, showing 0 for customers with no orders.', language: 'sql', hint: 'COALESCE(SUM(o.total), 0) with GROUP BY.', solution: 'SELECT c.name, COALESCE(SUM(o.total), 0) AS spend\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nGROUP BY c.name\nORDER BY spend DESC;' },
    {
      id: 'sql-j-e4',
      level: 'intermediate',
      kind: 'multiple-choice',
      prompt: 'customers holds Ada and Bo; orders holds a row only for Ada. How many rows does `customers LEFT JOIN orders` return?',
      options: ['1', '2', '0', '3'],
      answerIndex: 1,
      solution: '2 — every customer row survives; Bo appears once with NULL order columns.',
    },
  ],
  project: {
    objective: 'Answer three business questions with joins.',
    requirements: ['Revenue per customer', 'Customers with no orders', 'Order count per customer'],
    steps: ['Write each query separately', 'Check NULL handling', 'Order results meaningfully'],
    expected: 'Three queries that run without error and handle customers lacking orders.',
  },
}

const C_DEBUGGING: TopicContent = {
  id: 'c-debugging',
  subject: 'c',
  label: 'C debugging (syntax vs runtime vs logic)',
  keywords: /\b(debug(ging)?|segfault|segmentation fault|pointer|memory leak|gcc|compil(e|er) error)\b/i,
  prereqs: [],
  next: [],
  intro:
    'Debugging C means locating and fixing three different classes of problem: syntax errors (the compiler refuses), runtime errors (the program crashes or misbehaves while running, e.g. segfault) ' +
    'and logical errors (it runs but gives the wrong answer). Distinguishing them tells you where to look first.',
  keyIdeas: [
    { term: 'Syntax error', definition: 'The code violates the grammar; compilation fails with a file:line message.' },
    { term: 'Runtime error', definition: 'The program starts but crashes or has undefined behaviour at execution time (segfault, divide by zero).' },
    { term: 'Logical error', definition: 'Compiles and runs, but produces the wrong result (off-by-one, wrong operator).' },
    { term: 'Compiler warnings', definition: 'With -Wall -Wextra, gcc points at suspicious code before it bites you. Treat warnings as bugs.' },
  ],
  example: {
    language: 'c',
    code:
      '#include <stdio.h>\n\n' +
      'int main(void) {\n' +
      '    int nums[3] = {1, 2, 3};\n' +
      '    int sum = 0;\n' +
      '    for (int i = 0; i <= 3; i++)   // BUG: reads nums[3]\n' +
      '        sum += nums[i];\n' +
      '    printf("%d\\n", sum);\n' +
      '    return 0;\n' +
      '}\n',
    output: 'Undefined behaviour — reading nums[3] is out of bounds; the output is not reliable.',
    steps: [
      'The array has valid indices 0,1,2.',
      '`i <= 3` lets i reach 3, reading past the end — a logical error that becomes undefined behaviour.',
      'The fix is `i < 3`.',
      'Compiling with `-fsanitize=address` would have named the out-of-bounds read immediately.',
    ],
  },
  mistakes: [
    { mistake: 'Ignoring compiler warnings.', cause: 'gcc often warns about the exact bug (uninitialised variable, wrong format).', fix: 'Compile with -Wall -Wextra and fix every warning.' },
    { mistake: 'Off-by-one loop bounds on arrays.', cause: '`i <= n` instead of `i < n` reads one past the end.', fix: 'Use `i < n`; the last valid index is n-1.' },
    { mistake: 'Using a value before initialising it.', cause: 'C does not zero local variables.', fix: 'Initialise (`int sum = 0;`) or use a debugger/sanitiser to catch it.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'Triage order: compile → run → check logic.',
    nodes: [{ id: 'c', label: 'Compile (syntax?)' }, { id: 'r', label: 'Run (runtime?)' }, { id: 'l', label: 'Compare output (logic?)' }],
    edges: [{ from: 'c', to: 'r', label: 'ok' }, { from: 'r', to: 'l', label: 'ok' }],
  },
  revision: [
    { label: 'syntax', value: 'won’t compile — read the first error' },
    { label: 'runtime', value: 'crashes — segfault, UB' },
    { label: 'logic', value: 'runs, wrong answer' },
    { label: 'tooling', value: 'gcc -Wall -Wextra -fsanitize=address' },
  ],
  quiz: [
    { id: 'c-dbg-q1', level: 'beginner', kind: 'multiple-choice', prompt: 'A program compiles but prints the wrong total. What kind of error is this?', options: ['Syntax', 'Runtime', 'Logical', 'Linker'], answerIndex: 2, explanation: 'It compiles and runs, so the fault is in the logic.' },
    { id: 'c-dbg-q2', level: 'intermediate', kind: 'find-error', prompt: 'int a[2] = {5, 6}; for (int i = 0; i <= 2; i++) printf("%d", a[i]);', answer: '`i <= 2` reads a[2], which is out of bounds.', explanation: 'Valid indices are 0 and 1; use `i < 2`.' },
  ],
  exercises: [
    { id: 'c-dbg-e1', level: 'beginner', kind: 'find-error', prompt: 'Point out the bug: `for (int i = 0; i <= n; i++) sum += arr[i];`', language: 'c', hint: 'Look at the bound.', solution: 'Change to `i < n`: the last valid index is n-1.' },
    { id: 'c-dbg-e2', level: 'intermediate', kind: 'write-code', prompt: 'Write a loop that safely sums an int array of length n.', language: 'c', hint: 'i < n.', solution: 'int sum = 0;\nfor (int i = 0; i < n; i++) sum += arr[i];' },
    { id: 'c-dbg-e3', level: 'advanced', kind: 'scenario', prompt: 'A function returns a pointer to a local array. Explain the bug and fix it.', language: 'c', hint: 'Locals die at return.', solution: 'Returning the address of a local (stack) array is undefined behaviour — it is freed on return. Allocate on the heap with malloc, pass a caller-owned buffer, or use static storage if appropriate.' },
  ],
}

const EXCEL_LOOKUP: TopicContent = {
  id: 'excel-lookup',
  subject: 'excel',
  label: 'Excel lookup functions (VLOOKUP, INDEX/MATCH, XLOOKUP)',
  keywords: /\b(vlookup|hlookup|xlookup|index[\s/]*match|lookup|spreadsheet|excel)\b/i,
  prereqs: [],
  next: [],
  intro:
    'Lookup functions pull a value from one table using a key from another. They exist so you never copy data by hand and so a spreadsheet keeps working when values change. ' +
    'By the end you can choose between VLOOKUP, INDEX/MATCH and XLOOKUP and explain each argument.',
  keyIdeas: [
    { term: 'VLOOKUP', definition: 'Searches the first column of a range for a key and returns a value from a chosen column: =VLOOKUP(key, range, col, FALSE).' },
    { term: 'The FALSE argument', definition: 'Requests an exact match. Omitting it (TRUE) does an approximate match and is a classic bug.' },
    { term: 'INDEX/MATCH', definition: 'More flexible: =INDEX(return_col, MATCH(key, key_col, 0)); the lookup column can be anywhere.' },
    { term: 'XLOOKUP', definition: 'Modern replacement: =XLOOKUP(key, key_col, return_col); no column counting, exact match by default.' },
  ],
  example: {
    language: 'excel',
    code:
      'Prices:\n' +
      '  A        B\n' +
      '1 SKU      Price\n' +
      '2 A-100    12\n' +
      '3 B-200    30\n\n' +
      '=VLOOKUP("B-200", A2:B3, 2, FALSE)   → 30\n' +
      '=INDEX(B2:B3, MATCH("A-100", A2:A3, 0)) → 12\n' +
      '=XLOOKUP("A-100", A2:A3, B2:B3)        → 12\n',
    output: '30\n12\n12',
    steps: [
      'VLOOKUP finds the key in column A and returns column 2 of the range.',
      'INDEX/MATCH matches the position of the key, then INDEX returns the value at that position.',
      'XLOOKUP joins key and return columns directly.',
      'FALSE / the trailing 0 force an exact match.',
    ],
  },
  mistakes: [
    { mistake: 'Forgetting FALSE in VLOOKUP.', cause: 'Defaults to approximate match.', fix: 'Always pass FALSE for exact lookups (or use XLOOKUP).' },
    { mistake: 'Column index wrong after inserting a column.', cause: 'VLOOKUP counts columns, so inserts shift the target.', fix: 'Use INDEX/MATCH or XLOOKUP, which reference columns directly.' },
    { mistake: 'Key not found → #N/A.', cause: 'Trailing spaces or type mismatch (text "12" vs number 12).', fix: 'TRIM the keys and ensure matching types.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'Lookup = key → find position → return value from a second column.',
    nodes: [{ id: 'k', label: 'key "B-200"' }, { id: 'm', label: 'match in key column' }, { id: 'v', label: 'return Price 30' }],
    edges: [{ from: 'k', to: 'm' }, { from: 'm', to: 'v' }],
  },
  revision: [
    { label: 'VLOOKUP', value: '=VLOOKUP(key, range, col, FALSE)' },
    { label: 'INDEX/MATCH', value: '=INDEX(ret, MATCH(key, keycol, 0))' },
    { label: 'XLOOKUP', value: '=XLOOKUP(key, keycol, retcol)' },
    { label: 'exact match', value: 'FALSE or 0 or omit ~ in XLOOKUP' },
    { label: '#N/A', value: 'key not found (spaces/types)' },
  ],
  quiz: [
    { id: 'xl-q1', level: 'beginner', kind: 'predict-output', prompt: 'Prices has A-100→12. What does =VLOOKUP("A-100", A2:B3, 2, FALSE) return?', options: ['12', '30', '#N/A', 'A-100'], answerIndex: 0, explanation: 'The key is found and column 2 of the range is the price, 12.' },
    { id: 'xl-q2', level: 'intermediate', kind: 'multiple-choice', prompt: 'Why is INDEX/MATCH preferred over VLOOKUP?', options: ['It is faster to type.', 'It can look to the left and is not broken by column inserts.', 'It works without a key.', 'It never returns errors.'], answerIndex: 1, explanation: 'INDEX/MATCH references columns directly, so inserting a column does not shift the result.' },
  ],
  exercises: [
    { id: 'xl-e1', level: 'beginner', kind: 'write-code', prompt: 'Write a VLOOKUP to return the price for SKU in E1 from A2:B3.', language: 'excel', hint: 'Exact match.', solution: '=VLOOKUP(E1, A2:B3, 2, FALSE)' },
    { id: 'xl-e2', level: 'intermediate', kind: 'write-code', prompt: 'Rewrite it with INDEX/MATCH.', language: 'excel', hint: 'MATCH returns the row position.', solution: '=INDEX(B2:B3, MATCH(E1, A2:A3, 0))' },
    { id: 'xl-e3', level: 'advanced', kind: 'scenario', prompt: 'Return "?" instead of #N/A when the key is missing.', language: 'excel', hint: 'Wrap in IFERROR or IFNA.', solution: '=IFNA(XLOOKUP(E1, A2:A3, B2:B3), "?")' },
  ],
}

const LINUX_COMMANDS: TopicContent = {
  id: 'linux-commands',
  subject: 'linux',
  label: 'Linux command line basics',
  keywords: /\b(linux|bash|shell|terminal|command[- ]line|grep|chmod|permissions?|filesystem|unix)\b/i,
  prereqs: [],
  next: [],
  intro:
    'The Linux command line lets you inspect and control the system with short, composable tools. It matters because servers, containers and embedded boards are driven this way. ' +
    'You will learn to navigate, inspect and search files, and to read permissions, always preferring safe, read-only commands first.',
  keyIdeas: [
    { term: 'pwd / ls', definition: 'Print the working directory / list its contents (ls -l shows permissions, size, owner).' },
    { term: 'cd / cp / mv / rm', definition: 'Change directory / copy / move-rename / remove. `rm -r` deletes recursively — use with care.' },
    { term: 'grep', definition: 'Search text: `grep -rn "pattern" .` searches recursively with line numbers.' },
    { term: 'Permissions', definition: 'ls -l shows rwx for user/group/other. chmod changes them; the owner and group are shown too.' },
    { term: 'Pipes & redirection', definition: '`a | b` feeds a’s output into b; `>` writes output to a file, `>>` appends.' },
  ],
  example: {
    language: 'bash',
    code:
      '$ pwd\n/home/dev/project\n' +
      '$ ls -l\n' +
      '-rw-r--r--  1 dev dev  512 notes.txt\n' +
      'drwxr-xr-x  2 dev dev 4096 src\n' +
      '$ grep -rn "TODO" src | head -3\n' +
      'src/app.ts:12:// TODO: cache\n' +
      '$ chmod +x run.sh   # add execute for the owner\n',
    output: 'Working dir printed; notes.txt is readable (rw-r--r--); grep finds TODO lines; run.sh becomes executable.',
    steps: [
      'pwd shows where you are; always know before you rm.',
      'ls -l decodes permissions: -rw-r--r-- = owner read/write, group read, others read.',
      'grep -rn searches recursively with file:line prefixes.',
      'The pipe sends grep output into head, keeping only 3 lines.',
      'chmod +x adds the execute bit.',
    ],
  },
  mistakes: [
    { mistake: 'Running `rm -rf` without checking the path.', cause: 'It deletes recursively with no confirmation.', fix: 'pwd and ls first; quote paths; prefer moving to a trash dir.' },
    { mistake: 'Confusing `>` and `>>`.', cause: '`>` overwrites the file.', fix: 'Use `>>` to append; double-check the target file.' },
    { mistake: 'Editing a system file without sudo/backup.', cause: 'Permission denied, or an unrecoverable bad edit.', fix: 'Copy first (`cp f f.bak`), then edit carefully.' },
  ],
  diagram: {
    format: 'ascii',
    ascii:
      '/            <- root\n' +
      '├── home\n' +
      '│   └── dev  <- your files (pwd)\n' +
      '│       └── project\n' +
      '└── etc      <- system config\n',
    caption: 'The filesystem is a single tree rooted at /.',
  },
  revision: [
    { label: 'navigate', value: 'pwd, ls -l, cd' },
    { label: 'inspect', value: 'cat, less, head, tail' },
    { label: 'search', value: 'grep -rn "x" .' },
    { label: 'permissions', value: 'rwx rwx rwx = user/group/other' },
    { label: 'pipes', value: '| > >>' },
  ],
  quiz: [
    { id: 'lx-q1', level: 'beginner', kind: 'multiple-choice', prompt: 'Which command shows files with permissions and owner?', options: ['ls', 'ls -l', 'pwd', 'cat'], answerIndex: 1, explanation: 'ls -l prints the long format: permissions, links, owner, group, size, name.' },
    { id: 'lx-q2', level: 'intermediate', kind: 'predict-output', prompt: 'What does `grep -rn "TODO" src` do?', options: ['Deletes TODO lines', 'Searches src recursively and prints file:line matches', 'Renames files', 'Lists only directories'], answerIndex: 1, explanation: '-r is recursive, -n adds line numbers.' },
  ],
  exercises: [
    { id: 'lx-e1', level: 'beginner', kind: 'write-code', prompt: 'List all .log files in the current directory in long format.', language: 'bash', hint: 'Use a glob with ls -l.', solution: 'ls -l *.log' },
    { id: 'lx-e2', level: 'intermediate', kind: 'write-code', prompt: 'Find the 5 most recent lines containing "error" in app.log.', language: 'bash', hint: 'grep then tail.', solution: 'grep "error" app.log | tail -5' },
    { id: 'lx-e3', level: 'advanced', kind: 'scenario', prompt: 'A script is not executable. Diagnose and fix it, safely.', language: 'bash', hint: 'Check permissions, then add the execute bit.', solution: 'ls -l script.sh   # see missing x\nchmod +x script.sh\n./script.sh' },
  ],
}

const ELECTRONICS_BASICS: TopicContent = {
  id: 'electronics-basics',
  subject: 'electronics',
  label: 'Electronics & embedded fundamentals (Ohm’s law, GPIO)',
  keywords: /\b(electronics?|embedded|circuit|resistor|voltage|ohm|gpio|arduino|microcontroller|signal|pin|wiring)\b/i,
  prereqs: [],
  next: [],
  intro:
    'Electronics describes how voltage, current and resistance move energy through a circuit; embedded systems add a microcontroller that reads inputs and drives outputs. ' +
    'The goal is to reason about a simple circuit and a GPIO pin before touching hardware, because a wrong resistor value or a floating input is a real, physical bug.',
  keyIdeas: [
    { term: 'Voltage (V)', definition: 'The electrical “pressure” between two points, measured in volts.' },
    { term: 'Current (I)', definition: 'The flow of charge, measured in amperes.' },
    { term: 'Resistance (R)', definition: 'Opposition to current, measured in ohms.' },
    { term: 'Ohm’s law', definition: 'V = I × R — relate any two to find the third.' },
    { term: 'GPIO', definition: 'General-purpose input/output pins on a microcontroller: set them high/low (output) or read them (input).' },
    { term: 'Pull-up/pull-down', definition: 'A resistor that holds an input pin at a defined level so it is never “floating”.' },
  ],
  example: {
    language: 'c',
    code:
      '// Blink an LED on GPIO pin 13 (Arduino-style API)\n' +
      'const int LED = 13;\n\n' +
      'void setup() {\n' +
      '    pinMode(LED, OUTPUT);\n' +
      '}\n\n' +
      'void loop() {\n' +
      '    digitalWrite(LED, HIGH);  // 3.3V/5V on the pin\n' +
      '    delay(500);\n' +
      '    digitalWrite(LED, LOW);   // 0V\n' +
      '    delay(500);\n' +
      '}\n',
    output: 'The LED turns on for 0.5 s, off for 0.5 s, repeatedly.',
    steps: [
      'pinMode(OUTPUT) configures the pin to drive a signal.',
      'digitalWrite(HIGH) sets the pin to the supply voltage.',
      'A series resistor limits current so the LED is not damaged: R = (Vsupply − Vled) / I.',
      'delay makes the timing human-visible.',
    ],
  },
  mistakes: [
    { mistake: 'Forgetting the LED series resistor.', cause: 'Too much current flows.', fix: 'Add a resistor sized by Ohm’s law, e.g. (5 − 2)V / 0.015A ≈ 200Ω.' },
    { mistake: 'Leaving an input pin floating.', cause: 'It reads random noise.', fix: 'Enable the internal pull-up or add a pull-down resistor.' },
    { mistake: 'Wiring the LED backwards.', cause: 'An LED is polarised.', fix: 'Anode (long leg) toward the positive side.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'A GPIO output drives a resistor → LED → ground; the resistor sets the current.',
    nodes: [{ id: 'pin', label: 'GPIO HIGH' }, { id: 'r', label: 'Resistor R' }, { id: 'led', label: 'LED' }, { id: 'g', label: 'GND' }],
    edges: [{ from: 'pin', to: 'r' }, { from: 'r', to: 'led' }, { from: 'led', to: 'g' }],
  },
  revision: [
    { label: 'Ohm’s law', value: 'V = I × R' },
    { label: 'LED resistor', value: 'R = (Vs − Vled) / I' },
    { label: 'GPIO output', value: 'pinMode OUTPUT + digitalWrite' },
    { label: 'floating input', value: 'fix with pull-up/pull-down' },
  ],
  quiz: [
    { id: 'el-q1', level: 'beginner', kind: 'predict-output', prompt: 'A 5 V supply drives a 250Ω resistor. What current flows? (I = V / R)', options: ['0.02 A (20 mA)', '1250 A', '5 A', '250 A'], answerIndex: 0, explanation: 'I = 5 / 250 = 0.02 A = 20 mA.' },
    { id: 'el-q2', level: 'intermediate', kind: 'multiple-choice', prompt: 'Why add a pull-down resistor to a button input?', options: ['To brighten an LED', 'To hold the pin at a defined low so it does not float', 'To increase voltage', 'To store data'], answerIndex: 1, explanation: 'Without it a floating input reads random noise.' },
  ],
  exercises: [
    { id: 'el-e1', level: 'beginner', kind: 'scenario', prompt: 'Choose a resistor for a 2 V LED at 15 mA from a 5 V supply.', hint: 'R = (Vs − Vled) / I.', solution: 'R = (5 − 2) / 0.015 = 200Ω (choose the nearest standard value, 220Ω, to be safe).' },
    { id: 'el-e2', level: 'intermediate', kind: 'write-code', prompt: 'Write setup/loop to read a button on pin 2 and light an LED on pin 13.', language: 'c', hint: 'pinMode INPUT for the button; drive the LED with its state.', solution: 'void setup() {\n  pinMode(2, INPUT);\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(13, digitalRead(2));\n}' },
  ],
}

const ML_BASICS: TopicContent = {
  id: 'ml-basics',
  subject: 'ml',
  label: 'Machine learning basics (features, training, evaluation)',
  keywords: /\b(machine learning|ml|model|train(ing)?|dataset|features?|labels?|overfitting|classifier|regression|neural)\b/i,
  prereqs: [],
  next: [],
  intro:
    'Machine learning fits a model to data so it can make predictions on new data. The whole workflow is: pick features, split data, train, then evaluate on data the model has never seen. ' +
    'Understanding this pipeline prevents the most common failure — fooling yourself with a good score on the training data.',
  keyIdeas: [
    { term: 'Features vs labels', definition: 'Features are the inputs (X); the label is the thing to predict (y).' },
    { term: 'Train/test split', definition: 'Fit on the training set, measure on a held-out test set to estimate real performance.' },
    { term: 'Overfitting', definition: 'The model memorises the training data and does poorly on new data.' },
    { term: 'Metrics', definition: 'Accuracy for balanced classification; precision/recall for imbalance; MAE/RMSE for regression.' },
  ],
  example: {
    language: 'python',
    code:
      'from sklearn.model_selection import train_test_split\n' +
      'from sklearn.linear_model import LogisticRegression\n' +
      'from sklearn.metrics import accuracy_score\n\n' +
      'X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0)\n' +
      'model = LogisticRegression().fit(X_train, y_train)\n' +
      'pred = model.predict(X_test)\n' +
      'print("test accuracy:", round(accuracy_score(y_test, pred), 3))\n',
    output: 'test accuracy: 0.93   (example — depends on the data)',
    steps: [
      'train_test_split holds out 20% of the data the model never trains on.',
      'fit trains on the other 80%.',
      'predict makes predictions on the held-out set.',
      'accuracy_score reports performance on data the model has not seen — the honest number.',
    ],
  },
  mistakes: [
    { mistake: 'Evaluating on the training set.', cause: 'The model has already seen those answers.', fix: 'Always report test-set (or cross-validated) metrics.' },
    { mistake: 'Leaking the test set into training (scaling before split).', cause: 'Statistics from the test set leak in.', fix: 'Split first, fit transforms on train, apply to test.' },
    { mistake: 'Using accuracy on imbalanced data.', cause: '90% “accuracy” from predicting the majority class only.', fix: 'Use precision/recall or F1.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'The ML pipeline: data → split → train → evaluate → iterate.',
    nodes: [{ id: 'd', label: 'data' }, { id: 's', label: 'split' }, { id: 't', label: 'train' }, { id: 'e', label: 'evaluate (test)' }],
    edges: [{ from: 'd', to: 's' }, { from: 's', to: 't' }, { from: 't', to: 'e' }],
  },
  revision: [
    { label: 'X / y', value: 'features / label' },
    { label: 'split', value: 'train_test_split(..., test_size=0.2)' },
    { label: 'overfitting', value: 'great on train, poor on test' },
    { label: 'metrics', value: 'accuracy / precision-recall / RMSE' },
  ],
  quiz: [
    { id: 'ml-q1', level: 'beginner', kind: 'multiple-choice', prompt: 'Where should you measure model performance?', options: ['On the training set', 'On the test set', 'On the labels', 'On the features'], answerIndex: 1, explanation: 'The test set is unseen data, giving an honest estimate.' },
    { id: 'ml-q2', level: 'intermediate', kind: 'multiple-choice', prompt: 'A model scores 99% on training and 60% on test. What happened?', options: ['Underfitting', 'Overfitting', 'Perfect fit', 'Data leak'], answerIndex: 1, explanation: 'The large gap means the model memorised the training data.' },
  ],
  exercises: [
    { id: 'ml-e1', level: 'beginner', kind: 'write-code', prompt: 'Split X, y into 80/20 train/test.', language: 'python', hint: 'train_test_split.', solution: 'X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)' },
    { id: 'ml-e2', level: 'intermediate', kind: 'scenario', prompt: 'Your classifier is 95% accurate but catches almost no fraud. What metric should you use?', hint: 'Imbalanced classes.', solution: 'Use precision and recall (or F1 / PR-AUC): accuracy hides poor minority-class detection.' },
  ],
}

const APTITUDE: TopicContent = {
  id: 'aptitude',
  subject: 'aptitude',
  label: 'Aptitude: percentages & ratios',
  keywords: /\b(aptitude|percent(age)?|ratio|proportion|profit|loss|average|speed|distance|time|maths?|mathematics)\b/i,
  prereqs: [],
  next: [],
  intro:
    'Aptitude problems test structured reasoning with percentages, ratios and rates. They appear in placement and competitive tests, so the value is speed plus a method you can trust. ' +
    'We will use a formula → substitute → interpret structure on worked examples.',
  keyIdeas: [
    { term: 'Percentage', definition: 'A part per hundred: x% = x/100. "of" means multiply.' },
    { term: 'Percentage change', definition: '(new − old) / old × 100%.' },
    { term: 'Ratio', definition: 'A comparison of quantities, e.g. 3:2 means 3 parts to 2 parts.' },
    { term: 'Profit %', definition: '(SP − CP) / CP × 100.' },
  ],
  example: {
    language: 'text',
    code:
      'Q: A shirt costs ₹800. Its price rises 25%. What is the new price?\n\n' +
      'Step 1: increase      = 25% of 800 = 0.25 × 800 = 200\n' +
      'Step 2: new price      = 800 + 200 = 1000\n\n' +
      'Shortcut: 800 × 1.25 = 1000\n',
    output: '₹1000',
    steps: [
      'Translate "rises 25%" into a multiplier: 1 + 0.25 = 1.25.',
      'Multiply the original amount: 800 × 1.25 = 1000.',
      'Interpret: the new price is ₹1000. A 25% decrease would use 0.75.',
    ],
  },
  mistakes: [
    { mistake: 'Adding percentages of different bases.', cause: '10% of 100 then 10% of 200 are different amounts.', fix: 'Compute each percentage against its own base.' },
    { mistake: 'Reversing profit % denominator.', cause: 'Profit % is on cost price, not selling price.', fix: 'Use (SP − CP)/CP × 100.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'A percentage change becomes a single multiplier.',
    nodes: [{ id: 'o', label: 'original 800' }, { id: 'm', label: '× 1.25' }, { id: 'n', label: 'new 1000' }],
    edges: [{ from: 'o', to: 'm' }, { from: 'm', to: 'n' }],
  },
  revision: [
    { label: 'x% of N', value: ('' + 'x/100 × N') },
    { label: 'change %', value: '(new − old)/old × 100' },
    { label: 'increase', value: '× (1 + r)' },
    { label: 'decrease', value: '× (1 − r)' },
  ],
  quiz: [
    { id: 'ap-q1', level: 'beginner', kind: 'predict-output', prompt: 'A price of 500 falls by 20%. New price?', options: ['400', '480', '520', '100'], answerIndex: 0, explanation: '500 × 0.8 = 400.' },
    { id: 'ap-q2', level: 'intermediate', kind: 'predict-output', prompt: 'Cost 200, sold 250. Profit %?', options: ['20%', '25%', '50%', '12.5%'], answerIndex: 1, explanation: '(250 − 200)/200 × 100 = 25%.' },
  ],
  exercises: [
    { id: 'ap-e1', level: 'beginner', kind: 'write-code', prompt: 'Find 15% of 640.', hint: 'Use a multiplier.', solution: '0.15 × 640 = 96' },
    { id: 'ap-e2', level: 'intermediate', kind: 'scenario', prompt: 'Split ₹1200 in the ratio 3:5.', hint: 'Total parts = 8.', solution: '1200 / 8 = 150 per part → 3 parts = 450, 5 parts = 750.' },
  ],
}

const PYTHON_EXCEPTIONS: TopicContent = {
  id: 'python-exceptions',
  subject: 'python',
  label: 'Python exceptions & error handling',
  keywords: /\b(exceptions?|error handling|exception handling|traceback|except clause)\b|\btry\s*\/?\s*except\b/i,
  prereqs: ['python-functions'],
  next: ['python-oop'],
  intro:
    'An exception is Python’s way of signalling that something went wrong at run time — a missing key, a bad value, a division by zero. ' +
    'Handling them keeps a program alive and gives the user a clear message instead of a traceback. ' +
    'By the end you can catch specific errors, clean up with finally, and raise your own.',
  keyIdeas: [
    { term: 'Exception', definition: 'An object raised when an operation fails — e.g. ZeroDivisionError, KeyError, ValueError, FileNotFoundError.' },
    { term: 'try / except', definition: 'Risky code goes in try; if it raises, the matching except block runs instead of crashing the program.' },
    { term: 'Specific vs broad', definition: 'Catch the narrowest type you can (except ValueError) — a bare except hides real bugs.' },
    { term: 'finally', definition: 'A block that always runs, whether or not an exception occurred; used to release resources.' },
    { term: 'raise', definition: 'Raise an exception yourself when a value violates a rule: raise ValueError("age must be >= 0").' },
  ],
  example: {
    language: 'python',
    code:
      'def safe_div(a, b):\n' +
      '    try:\n' +
      '        return a / b\n' +
      '    except ZeroDivisionError:\n' +
      '        return None\n' +
      '    finally:\n' +
      '        print("checked")\n\n' +
      'print(safe_div(10, 2))\n' +
      'print(safe_div(10, 0))\n',
    output: 'checked\n5.0\nchecked\nNone',
    steps: [
      'safe_div(10, 2) returns 5.0; finally prints "checked" before the call completes.',
      'safe_div(10, 0) raises ZeroDivisionError, so the except block returns None.',
      'finally runs again, printing "checked" even though an exception was caught.',
      'The program never crashes — the caller receives None instead of a traceback.',
    ],
  },
  mistakes: [
    { mistake: 'A bare `except:` that swallows everything.', cause: 'It also hides KeyboardInterrupt and genuine bugs.', fix: 'Catch a specific type, or `except Exception as e:` and log it.', code: 'try:\n    risky()\nexcept ValueError as e:\n    print("bad value:", e)' },
    { mistake: 'Assuming an except block catches errors it does not name.', cause: 'Only the matching type (or a superclass) is caught.', fix: 'Catch the exact exception, or order several except blocks from specific to general.' },
    { mistake: 'Putting cleanup code inside the try block.', cause: 'It is skipped the moment an exception is raised.', fix: 'Put cleanup in finally, or use a with-statement.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'try runs; on error the matching except runs; finally always runs.',
    nodes: [
      { id: 'try', label: 'try: risky code' },
      { id: 'ok', label: 'no error → continue' },
      { id: 'except', label: 'error → except handler' },
      { id: 'fin', label: 'finally: always runs' },
    ],
    edges: [
      { from: 'try', to: 'ok', label: 'success' },
      { from: 'try', to: 'except', label: 'raises' },
      { from: 'except', to: 'fin' },
      { from: 'ok', to: 'fin' },
    ],
  },
  revision: [
    { label: 'try/except', value: 'catch a specific exception type' },
    { label: 'finally', value: 'always runs (cleanup)' },
    { label: 'raise', value: 'raise ValueError("message")' },
    { label: 'common types', value: 'ValueError, KeyError, ZeroDivisionError, FileNotFoundError' },
  ],
  quiz: [
    { id: 'py-ex-q1', level: 'beginner', kind: 'multiple-choice', prompt: 'Which block always runs, whether or not an exception occurs?', options: ['try', 'except', 'else', 'finally'], answerIndex: 3, explanation: 'finally is guaranteed to run, which is why it is used for cleanup.' },
    { id: 'py-ex-q2', level: 'intermediate', kind: 'predict-output', prompt: 'What prints?\n\ntry:\n    print(1 / 0)\nexcept ZeroDivisionError:\n    print("caught")', options: ['caught', '1/0', 'ZeroDivisionError', 'nothing is printed'], answerIndex: 0, explanation: '1/0 raises ZeroDivisionError, so the except block prints "caught".' },
    { id: 'py-ex-q3', level: 'advanced', kind: 'find-error', prompt: 'Why is this dangerous?\n\ntry:\n    x = int(user_input)\nexcept:\n    pass', answer: 'The bare except silently hides every error, including unexpected ones, so real bugs go unnoticed.', explanation: 'Catch ValueError specifically and tell the user what went wrong.' },
  ],
  exercises: [
    { id: 'py-ex-e1', level: 'beginner', kind: 'write-code', prompt: 'Write `safe_int(s)` returning int(s), or 0 if the conversion fails.', language: 'python', hint: 'Catch ValueError.', solution: 'def safe_int(s):\n    try:\n        return int(s)\n    except ValueError:\n        return 0' },
    { id: 'py-ex-e2', level: 'intermediate', kind: 'write-code', prompt: 'Write `set_age(age)` that raises ValueError when age is negative.', language: 'python', hint: 'Use raise with a message.', solution: 'def set_age(age):\n    if age < 0:\n        raise ValueError("age must be >= 0")\n    return age' },
    { id: 'py-ex-e3', level: 'advanced', kind: 'scenario', prompt: 'A file is opened inside a try block but is never closed. Fix it so the file always closes.', language: 'python', hint: 'Use finally or a with-statement.', solution: 'with open("data.txt") as f:\n    data = f.read()\n# or wrap in try/finally and call f.close()' },
  ],
}

const SQL_SELECT: TopicContent = {
  id: 'sql-select',
  subject: 'sql',
  label: 'SQL SELECT & WHERE',
  keywords: /\b(select statement|select clause|where clause|filter(ing)? rows|distinct)\b/i,
  prereqs: [],
  next: ['sql-joins'],
  intro:
    'SELECT asks a question of a table and returns the matching rows as a result set. WHERE decides which rows qualify, and ORDER BY / LIMIT control the order and how many you see. ' +
    'This is the foundation every other query builds on.',
  keyIdeas: [
    { term: 'SELECT', definition: 'Names the columns to return (or * for all of them).' },
    { term: 'FROM', definition: 'Names the table (or tables) the rows come from.' },
    { term: 'WHERE', definition: 'Keeps only rows that satisfy a condition; it is evaluated before SELECT.' },
    { term: 'ORDER BY / LIMIT', definition: 'Sort the result (ASC/DESC) and cap how many rows are returned.' },
    { term: 'DISTINCT', definition: 'Removes duplicate result rows.' },
  ],
  example: {
    language: 'sql',
    code:
      "-- employees(id, name, dept, salary)\n" +
      'SELECT name, salary\n' +
      'FROM employees\n' +
      "WHERE dept = 'ENG'\n" +
      'ORDER BY salary DESC\n' +
      'LIMIT 2;\n',
    output:
      'name | salary\n' +
      '---- | ------\n' +
      'Ana  | 120\n' +
      'Bo   | 100\n',
    steps: [
      'FROM employees chooses the table.',
      "WHERE dept = 'ENG' keeps only engineering rows.",
      'ORDER BY salary DESC sorts highest first.',
      'LIMIT 2 returns the top two rows.',
    ],
  },
  mistakes: [
    { mistake: 'Comparing against NULL with =.', cause: '`col = NULL` is never true.', fix: 'Use `col IS NULL` / `col IS NOT NULL`.' },
    { mistake: 'Forgetting quotes around text literals.', cause: '`dept = ENG` is read as a column name, not a string.', fix: "Wrap string values in single quotes: 'ENG'." },
    { mistake: 'Using SELECT * in production.', cause: 'It returns columns you do not need and breaks when the schema changes.', fix: 'List the columns you actually use.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'Evaluation order: FROM → WHERE → SELECT → ORDER BY → LIMIT.',
    nodes: [
      { id: 'from', label: 'FROM employees' },
      { id: 'where', label: "WHERE dept = 'ENG'" },
      { id: 'select', label: 'SELECT name, salary' },
      { id: 'order', label: 'ORDER BY salary DESC' },
      { id: 'limit', label: 'LIMIT 2' },
    ],
    edges: [
      { from: 'from', to: 'where' },
      { from: 'where', to: 'select' },
      { from: 'select', to: 'order' },
      { from: 'order', to: 'limit' },
    ],
  },
  revision: [
    { label: 'shape', value: 'SELECT cols FROM table WHERE cond' },
    { label: 'order', value: 'FROM → WHERE → SELECT → ORDER BY → LIMIT' },
    { label: 'unique rows', value: 'DISTINCT' },
    { label: 'NULL test', value: 'IS NULL / IS NOT NULL' },
  ],
  quiz: [
    { id: 'sql-s-q1', level: 'beginner', kind: 'multiple-choice', prompt: 'Which clause filters which rows are returned?', options: ['SELECT', 'FROM', 'WHERE', 'ORDER BY'], answerIndex: 2, explanation: 'WHERE keeps only rows that satisfy its condition.' },
    { id: 'sql-s-q2', level: 'intermediate', kind: 'predict-output', prompt: "employees = Ana(ENG,120), Bo(ENG,100), Cy(SALES,90). How many rows does `WHERE dept = 'ENG'` return?", options: ['1', '2', '3', '0'], answerIndex: 1, explanation: 'Only Ana and Bo are in ENG, so two rows are returned.' },
  ],
  exercises: [
    { id: 'sql-s-e1', level: 'beginner', kind: 'write-code', prompt: 'Return the name and salary of every employee earning more than 100.', language: 'sql', hint: 'Use WHERE with a numeric comparison.', solution: 'SELECT name, salary\nFROM employees\nWHERE salary > 100;' },
    { id: 'sql-s-e2', level: 'intermediate', kind: 'write-code', prompt: 'Return the distinct departments, sorted alphabetically.', language: 'sql', hint: 'DISTINCT with ORDER BY.', solution: 'SELECT DISTINCT dept\nFROM employees\nORDER BY dept;' },
    { id: 'sql-s-e3', level: 'advanced', kind: 'scenario', prompt: 'Return the top 3 earners overall, highest first.', language: 'sql', hint: 'ORDER BY DESC then LIMIT.', solution: 'SELECT name, salary\nFROM employees\nORDER BY salary DESC\nLIMIT 3;' },
  ],
}

const SQL_NULL_GROUP: TopicContent = {
  id: 'sql-null-group',
  subject: 'sql',
  label: 'SQL NULL handling & GROUP BY',
  keywords: /\b(sql null|null handling|group by|having clause|aggregate function|aggregation|count\(|sum\()\b/i,
  prereqs: ['sql-select'],
  next: ['sql-joins'],
  intro:
    'GROUP BY collapses many rows into one row per group so you can summarise them with aggregate functions (COUNT, SUM, AVG, MIN, MAX). ' +
    'NULL means "no value", and it behaves unlike any other value — which is exactly why summaries and filters go wrong when NULL is ignored.',
  keyIdeas: [
    { term: 'Aggregate function', definition: 'Turns a set of rows into one value: COUNT, SUM, AVG, MIN, MAX.' },
    { term: 'GROUP BY', definition: 'Forms one output row per distinct group; every non-aggregated selected column must appear here.' },
    { term: 'HAVING', definition: 'Filters groups after aggregation (WHERE filters individual rows before it).' },
    { term: 'NULL', definition: 'The absence of a value; it is not equal to anything, even another NULL.' },
    { term: 'COUNT(*) vs COUNT(col)', definition: 'COUNT(*) counts rows; COUNT(col) counts only rows where col IS NOT NULL.' },
  ],
  example: {
    language: 'sql',
    code:
      '-- orders(id, customer_id, total)\n' +
      'SELECT customer_id,\n' +
      '       COUNT(*)   AS orders,\n' +
      '       SUM(total) AS spend\n' +
      'FROM orders\n' +
      'GROUP BY customer_id\n' +
      'HAVING SUM(total) > 100\n' +
      'ORDER BY spend DESC;\n',
    output:
      'customer_id | orders | spend\n' +
      '----------- | ------ | -----\n' +
      '1           | 2      | 250\n' +
      '3           | 1      | 120\n',
    steps: [
      'GROUP BY customer_id puts every row for a customer into one group.',
      'COUNT(*) counts rows in the group; SUM(total) adds their totals.',
      'HAVING keeps only groups whose total spend is over 100.',
      'ORDER BY spend DESC sorts the surviving groups.',
    ],
  },
  mistakes: [
    { mistake: 'Selecting a column that is neither grouped nor aggregated.', cause: 'SQL cannot know which value of the group to return.', fix: 'Add the column to GROUP BY, or wrap it in an aggregate such as MAX(col).' },
    { mistake: 'Filtering an aggregate in WHERE.', cause: 'WHERE runs before grouping, so it cannot see SUM/COUNT.', fix: 'Put the aggregate condition in HAVING.' },
    { mistake: '`col = NULL` never matches.', cause: 'NULL means unknown, so equality is never true.', fix: 'Use IS NULL / IS NOT NULL.' },
  ],
  diagram: {
    format: 'flow',
    caption: 'Rows → grouped → aggregated → filtered by HAVING → sorted.',
    nodes: [
      { id: 'rows', label: 'rows' },
      { id: 'grp', label: 'GROUP BY customer_id' },
      { id: 'agg', label: 'COUNT / SUM per group' },
      { id: 'hav', label: 'HAVING' },
      { id: 'ord', label: 'ORDER BY' },
    ],
    edges: [
      { from: 'rows', to: 'grp' },
      { from: 'grp', to: 'agg' },
      { from: 'agg', to: 'hav' },
      { from: 'hav', to: 'ord' },
    ],
  },
  revision: [
    { label: 'aggregate', value: 'COUNT, SUM, AVG, MIN, MAX' },
    { label: 'grouping', value: 'GROUP BY the key columns' },
    { label: 'HAVING', value: 'filter groups (after aggregation)' },
    { label: 'NULL', value: 'IS NULL; COUNT(col) skips NULLs' },
  ],
  quiz: [
    { id: 'sql-ng-q1', level: 'beginner', kind: 'multiple-choice', prompt: 'Which clause filters groups after aggregation?', options: ['WHERE', 'HAVING', 'ORDER BY', 'GROUP BY'], answerIndex: 1, explanation: 'HAVING runs after GROUP BY; WHERE filters individual rows first.' },
    { id: 'sql-ng-q2', level: 'intermediate', kind: 'predict-output', prompt: 'A column holds 10, NULL, 20. What does COUNT(col) return?', options: ['3', '2', '1', 'NULL'], answerIndex: 1, explanation: 'COUNT(col) ignores NULL, so it counts 10 and 20 — 2.' },
    { id: 'sql-ng-q3', level: 'advanced', kind: 'find-error', prompt: 'Why does `SELECT dept, name, COUNT(*) FROM employees GROUP BY dept` fail in strict SQL?', answer: 'name is neither grouped nor aggregated, so the database cannot choose one value per group.', explanation: 'Either group by name too, or wrap it in an aggregate such as MAX(name).' },
  ],
  exercises: [
    { id: 'sql-ng-e1', level: 'beginner', kind: 'write-code', prompt: 'Count the orders per customer.', language: 'sql', hint: 'GROUP BY customer with COUNT(*).', solution: 'SELECT customer_id, COUNT(*) AS orders\nFROM orders\nGROUP BY customer_id;' },
    { id: 'sql-ng-e2', level: 'intermediate', kind: 'write-code', prompt: 'Show departments with more than 5 employees.', language: 'sql', hint: 'GROUP BY then HAVING.', solution: 'SELECT dept, COUNT(*) AS n\nFROM employees\nGROUP BY dept\nHAVING COUNT(*) > 5;' },
    { id: 'sql-ng-e3', level: 'advanced', kind: 'scenario', prompt: 'Find customers whose summed spend is NULL (i.e. no countable orders).', language: 'sql', hint: 'Aggregate then test with HAVING ... IS NULL.', solution: 'SELECT customer_id, SUM(total) AS spend\nFROM orders\nGROUP BY customer_id\nHAVING SUM(total) IS NULL;' },
  ],
}

export const TOPICS: TopicContent[] = [
  PYTHON_OOP,
  PYTHON_FUNCTIONS,
  PYTHON_EXCEPTIONS,
  SQL_JOINS,
  SQL_SELECT,
  SQL_NULL_GROUP,
  C_DEBUGGING,
  EXCEL_LOOKUP,
  LINUX_COMMANDS,
  ELECTRONICS_BASICS,
  ML_BASICS,
  APTITUDE,
]

export function getTopic(id: string): TopicContent | undefined {
  return TOPICS.find((t) => t.id === id)
}
