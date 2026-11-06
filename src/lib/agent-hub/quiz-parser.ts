export interface InteractiveQuiz {
  number: string
  prompt: string
  options: { letter: string; text: string }[]
  correctLetter?: string
  explanation?: string
  quickExplanation?: string
  title?: string
  details?: string
}

type MarkdownSegment = { type: 'markdown'; content: string } | { type: 'quiz'; quiz: InteractiveQuiz }

export function calculateQuizScore(
  quizzes: ReadonlyArray<Pick<InteractiveQuiz, 'number' | 'correctLetter'>>,
  answers: Readonly<Record<string, string>>,
): number {
  return quizzes.filter((quiz) => quiz.correctLetter && answers[quiz.number] === quiz.correctLetter).length
}

// Convert the tutor's numbered-question/list format into controls while leaving
// surrounding Markdown intact. The answer key stays out of the rendered text.
export function splitInteractiveQuizzes(content: string): MarkdownSegment[] {
  const lines = content.split('\n')
  // Sample code may itself contain numbered questions or answer keys. Preserve
  // ordinary fenced blocks verbatim, including an unfinished streaming fence.
  const codeLines = new Set<number>()
  let fence: { marker: string; width: number; protect: boolean } | undefined
  lines.forEach((line, index) => {
    if (fence) {
      if (fence.protect) codeLines.add(index)
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence.marker && close[1].length >= fence.width) fence = undefined
      return
    }
    const open = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (open) {
      fence = { marker: open[1][0], width: open[1].length, protect: open[2].trim().toLowerCase() !== 'answer' }
      if (fence.protect) codeLines.add(index)
    }
  })
  const segments: MarkdownSegment[] = []
  const quizLocations: Array<{ start: number; segment: number }> = []
  const bulkAnswers = [...content.matchAll(/```answer\s*\n([\s\S]*?)```/gi)].flatMap((match) => {
    if (codeLines.has(content.slice(0, match.index).split('\n').length - 1)) return []
    const entries = match[1].trim().split(/(?=^\s*Correct\s*:)/gim).flatMap((chunk) => {
      const entry = /^\s*Correct\s*:\s*([A-Z])\.?\s*(?:Explanation\s*:\s*)?([\s\S]*?)\s*$/i.exec(chunk)
      return entry ? [{ letter: entry[1].toUpperCase(), explanation: entry[2].trim() }] : []
    })
    return entries.length > 1 ? [{ start: content.slice(0, match.index).split('\n').length - 1, entries }] : []
  })
  const questionPattern = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(?:(?:Question|Q)\s*)?\d+[.:)](?:\*\*|__)?\s+/i
  const optionPattern = /^\s*(?:[-*+]\s*)?(?:\*\*)?([A-Z])(?:[.)])(?:\*\*)?\s+(.+?)\s*$/
  const summaryPattern = /^\s*(?:\*\*)?(?:answers?|correct answers?)(?:\*\*)?\s*:\s*(.+)$/i
  const answerLinePattern = /^\s*(?:(?:\*\*|__)\s*)?(?:answer|correct answer)(?:(?:\*\*|__)\s*)?\s*:\s*([A-Z])(?:\s*[.)-])?\s*(.*?)(?:\*\*|__)?\s*$/i
  const hasMcqStructure = lines.some((line, i) => !codeLines.has(i) && questionPattern.test(line)) && lines.some((line, i) => !codeLines.has(i) && optionPattern.test(line))
  const answerKeys = new Map<string, string>()
  const answerSummaryLines = new Set<number>()
  if (hasMcqStructure) {
    lines.forEach((line, lineIndex) => {
      if (codeLines.has(lineIndex)) return
      const summary = summaryPattern.exec(line)
      if (!summary) return
      let foundKey = false
      for (const [, number, letter] of summary[1].matchAll(/(\d+)\s*[-:.)]\s*([A-Z])/gi)) {
        answerKeys.set(number, letter.toUpperCase())
        foundKey = true
      }
      if (foundKey) answerSummaryLines.add(lineIndex)
    })
  }
  let markdown: string[] = []
  let quizTitle: string | undefined
  let quizDetails: string | undefined
  let index = 0

  while (index < lines.length) {
    if (codeLines.has(index)) {
      markdown.push(lines[index++])
      continue
    }
    // Model-generated explanation summaries belong to the preceding quiz,
    // not ordinary Markdown that would reveal answers before submission.
    const explanationHeading = lines[index].trim().replace(/^#{1,6}\s+/, '').replace(/\*\*|__/g, '').trim()
    const precedingQuiz = segments.findLast((segment) => segment.type === 'quiz')
    if (/^(?:quick\s+)?explanations?\s*:?$/i.test(explanationHeading) && precedingQuiz?.type === 'quiz') {
      const start = index++
      while (index < lines.length && !/^\s*#{1,6}\s+/.test(lines[index]) && !questionPattern.test(lines[index])) index += 1
      precedingQuiz.quiz.quickExplanation = lines.slice(start, index).join('\n').trim()
      continue
    }
    const questionStart = index
    if (answerSummaryLines.has(index)) {
      index += 1
      continue
    }
    const question = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(?:(?:Question|Q)\s*)?(\d+)[.:)](?:\*\*|__)?\s*(.*?)(?:\*\*|__)?\s*$/i.exec(lines[index])
    if (!question) {
      markdown.push(lines[index])
      index += 1
      continue
    }

    const wrappedPrompt = /^(?:\*\*|__)([\s\S]*?)(?:\*\*|__)$/.exec(question[2].trim())
    let prompt = (wrappedPrompt?.[1] ?? question[2]).trim()
    let optionIndex = index + 1
    while (optionIndex < lines.length && !lines[optionIndex].trim()) optionIndex += 1
    if (!prompt && optionIndex < lines.length && !questionPattern.test(lines[optionIndex]) && !optionPattern.test(lines[optionIndex]) && !/^\s*```/.test(lines[optionIndex])) {
      const nextLine = lines[optionIndex].trim()
      const wrappedNextLine = /^(?:\*\*|__)([\s\S]*?)(?:\*\*|__)$/.exec(nextLine)
      prompt = (wrappedNextLine?.[1] ?? nextLine).trim()
      optionIndex += 1
    }
    const options: InteractiveQuiz['options'] = []
    let markedCorrectLetter: string | undefined
    let afterOptions = optionIndex
    while (afterOptions < lines.length) {
      const option = optionPattern.exec(lines[afterOptions])
      if (option) {
        const letter = option[1].toUpperCase()
        const rawText = option[2]
        if (/[✓✔✅]/u.test(rawText)) markedCorrectLetter = letter
        const text = rawText
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/__(.*?)__/g, '$1')
          .replace(/[✓✔✅]/gu, '')
          .trim()
        options.push({ letter, text })
        afterOptions += 1
        continue
      }
      if (!lines[afterOptions].trim()) {
        let next = afterOptions + 1
        while (next < lines.length && !lines[next].trim()) next += 1
        if (next < lines.length && optionPattern.test(lines[next])) {
          afterOptions = next
          continue
        }
      }
      break
    }

    if (options.length < 2) {
      markdown.push(lines[index])
      index += 1
      continue
    }

    if (markdown.length) {
      const isSeparator = (line: string) => /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())
      const hasInterveningContent = markdown.some((line) => line.trim() && !isSeparator(line))
      if (hasInterveningContent) {
        // A real prose block between quizzes starts a new quiz group. Blank
        // lines and horizontal rules between numbered questions do not.
        quizTitle = undefined
        quizDetails = undefined
      }
      let titleIndex = markdown.length - 1
      while (titleIndex >= 0 && (!markdown[titleIndex].trim() || isSeparator(markdown[titleIndex]))) titleIndex -= 1
      const plainDetails = titleIndex >= 0
        ? markdown[titleIndex].trim().replace(/^(?:\*\*|__)([\s\S]*?)(?:\*\*|__)$/, '$1').trim()
        : ''
      const detailsMatch = titleIndex >= 0 && /^(\d+\s+questions?\b.*|(?:beginner|intermediate|advanced)\s+level\b.*)$/i.test(plainDetails)
      if (detailsMatch) {
        quizDetails = plainDetails
        titleIndex -= 1
        while (titleIndex >= 0 && (!markdown[titleIndex].trim() || isSeparator(markdown[titleIndex]))) titleIndex -= 1
      }
      const heading = titleIndex >= 0 && /^\s*(?:#{1,6}\s+)?(.+?)\s*$/.exec(markdown[titleIndex])
      const headingText = heading?.[1]?.replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1').trim()
      const mcqHeading = headingText && /^(?:mcqs?|quiz|knowledge check)\s*:\s*(.+)$/i.exec(headingText)
      if (headingText && (mcqHeading || /(?:mcq|quiz|knowledge check)/i.test(headingText))) {
        quizTitle = mcqHeading ? `${mcqHeading[1].trim()} — MCQ Test` : headingText
        markdown = markdown.slice(0, titleIndex)
        let trailing = markdown.length - 1
        while (trailing >= 0 && (!markdown[trailing].trim() || isSeparator(markdown[trailing]))) trailing -= 1
        markdown = markdown.slice(0, trailing + 1)
      }
      const prose = markdown.filter((line) => !isSeparator(line)).join('\n').trim()
      if (prose) segments.push({ type: 'markdown', content: prose })
    }
    markdown = []

    const quiz: InteractiveQuiz = {
      number: question[1],
      prompt,
      options,
      correctLetter: markedCorrectLetter ?? answerKeys.get(question[1]),
      title: quizTitle,
      details: quizDetails,
    }
    let answerStart = afterOptions
    while (answerStart < lines.length && !lines[answerStart].trim()) answerStart += 1
    let answerWrapperEnd = -1
    if (/^<details\b/i.test(lines[answerStart]?.trim() ?? '')) {
      answerWrapperEnd = lines.findIndex((line, lineIndex) => lineIndex > answerStart && /^\s*<\/details\s*>\s*$/i.test(line))
      if (answerWrapperEnd > answerStart) {
        const wrappedAnswerStart = lines.findIndex((line, lineIndex) => lineIndex > answerStart && lineIndex < answerWrapperEnd && /^\s*```\s*answer\s*$/i.test(line))
        if (wrappedAnswerStart > answerStart) answerStart = wrappedAnswerStart
      }
    }
    if (lines[answerStart]?.trim() === '```answer') {
      const answerEnd = lines.indexOf('```', answerStart + 1)
      if (answerEnd > answerStart) {
        const answerText = lines.slice(answerStart + 1, answerEnd).join('\n')
        const answer = /Correct\s*:\s*([A-Z])\.?\s*(?:Explanation\s*:\s*([\s\S]*))?/i.exec(answerText)
        const correctLetter = answer?.[1]?.toUpperCase()
        if (correctLetter && options.some((option) => option.letter === correctLetter)) {
          quiz.correctLetter = correctLetter
          quiz.explanation = answer?.[2]?.trim()
          index = Math.max(answerEnd, answerWrapperEnd) + 1
          while (index < lines.length && !lines[index].trim()) index += 1
        } else {
          index = afterOptions
        }
      } else {
        index = afterOptions
      }
    } else {
      const answerLine = answerLinePattern.exec(lines[answerStart] ?? '')
      const answerLetter = answerLine?.[1]?.toUpperCase()
      if (answerLetter && options.some((option) => option.letter === answerLetter)) {
        quiz.correctLetter = answerLetter
        const inlineExplanation = /\bExplanation\s*:\s*([\s\S]*)$/i.exec(answerLine?.[2] ?? '')
        quiz.explanation = inlineExplanation?.[1]?.trim()
        index = answerStart + 1
        while (index < lines.length && !lines[index].trim()) index += 1
        const separateExplanation = /^\s*(?:explanation|why)\s*:\s*(.*)$/i.exec(lines[index] ?? '')
        if (separateExplanation) {
          const explanationLines = [separateExplanation[1].trim()]
          index += 1
          while (index < lines.length && lines[index].trim() && !questionPattern.test(lines[index]) && !optionPattern.test(lines[index])) {
            explanationLines.push(lines[index].trim())
            index += 1
          }
          quiz.explanation = [quiz.explanation, ...explanationLines].filter(Boolean).join('\n')
          while (index < lines.length && !lines[index].trim()) index += 1
        }
      } else {
        index = afterOptions
      }
    }
    quizLocations.push({ start: questionStart, segment: segments.length })
    segments.push({ type: 'quiz', quiz })
  }

  if (markdown.length) segments.push({ type: 'markdown', content: markdown.join('\n') })
  // Some models place ordered keys together after the final question. Accept
  // that variation only when the key count exactly matches the preceding quiz
  // group, and every letter names a real option. Never invent a missing key.
  for (const answers of bulkAnswers) {
    const location = quizLocations.findLast((item) => item.start < answers.start)
    if (!location) continue
    const group: InteractiveQuiz[] = []
    for (let i = location.segment; i >= 0; i -= 1) {
      const segment = segments[i]
      if (segment.type !== 'quiz') break
      group.unshift(segment.quiz)
    }
    if (group.length !== answers.entries.length || !group.every((quiz, i) => quiz.options.some((option) => option.letter === answers.entries[i].letter))) continue
    group.forEach((quiz, i) => { quiz.correctLetter = answers.entries[i].letter; quiz.explanation = answers.entries[i].explanation })
  }
  return segments
}

