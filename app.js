(function () {
  const chapters = Array.isArray(window.CHAPTERS) ? window.CHAPTERS : [];
  const storageKey = "ielts-synonyms-web-progress-v2";
  const mobileQuery = window.matchMedia("(max-width: 980px)");
  const uiState = {
    isSettingsOpen: false,
    resetSelection: new Set(),
    picked: null,
  };
  const dragState = {
    active: false,
    pending: false,
    pointerY: null,
    timer: null,
    ghost: null,
    source: null,
    currentTarget: null,
    payload: null,
    offsetX: 20,
    offsetY: 16,
    startX: 0,
    startY: 0,
  };

  if (!chapters.length) {
    document.getElementById("mainContent").innerHTML =
      '<div class="loading-card">未找到题库数据，请先运行 <code>node ./scripts/parse-markdown.js</code> 生成数据。</div>';
    return;
  }

  let state = loadState();

  document.addEventListener("click", handleClick);
  document.addEventListener("change", handleChange);

  render();

  function loadState() {
    const defaults = {
      currentChapterId: chapters[0].id,
      sidebarCollapsed: mobileQuery.matches,
      chapters: Object.fromEntries(chapters.map((chapter) => [chapter.id, createEmptyChapterState(chapter)])),
    };

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved) return defaults;

      const merged = JSON.parse(JSON.stringify(defaults));
      if (saved.currentChapterId && merged.chapters[saved.currentChapterId]) {
        merged.currentChapterId = saved.currentChapterId;
      }
      merged.sidebarCollapsed = Boolean(saved.sidebarCollapsed);

      for (const chapter of chapters) {
        const savedChapter = saved.chapters?.[chapter.id];
        if (!savedChapter) continue;

        merged.chapters[chapter.id] = {
          matching: {
            placements: { ...merged.chapters[chapter.id].matching.placements, ...(savedChapter.matching?.placements || {}) },
            checked: Boolean(savedChapter.matching?.checked),
          },
          choices: {
            answers: { ...merged.chapters[chapter.id].choices.answers, ...(savedChapter.choices?.answers || {}) },
            checked: Boolean(savedChapter.choices?.checked),
          },
          test: {
            placements: mergeTestPlacements(
              merged.chapters[chapter.id].test.placements,
              savedChapter.test?.placements || {},
            ),
            checked: Boolean(savedChapter.test?.checked),
          },
        };
      }

      return merged;
    } catch (error) {
      console.warn("Progress could not be loaded.", error);
      return defaults;
    }
  }

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function createEmptyChapterState(chapter) {
    const matchingPlacements = {};
    chapter.matching.prompts.forEach((prompt) => {
      matchingPlacements[prompt.id] = null;
    });

    const testPlacements = {};
    chapter.testYourself.forEach((item) => {
      testPlacements[item.id] = [];
    });

    return {
      matching: {
        placements: matchingPlacements,
        checked: false,
      },
      choices: {
        answers: {},
        checked: false,
      },
      test: {
        placements: testPlacements,
        checked: false,
      },
    };
  }

  function mergeTestPlacements(defaultPlacements, savedPlacements) {
    const result = {};
    Object.keys(defaultPlacements).forEach((key) => {
      result[key] = Array.isArray(savedPlacements[key]) ? [...savedPlacements[key]] : [];
    });
    return result;
  }

  function getCurrentChapter() {
    return chapters.find((chapter) => chapter.id === state.currentChapterId) || chapters[0];
  }

  function getChapterState(chapterId) {
    return state.chapters[chapterId];
  }

  function render() {
    const chapter = getCurrentChapter();
    const chapterState = getChapterState(chapter.id);

    renderSidebar(chapter);
    renderMain(chapter, chapterState);
    renderSettings(chapter);
    syncShellUi();
    saveState();
  }

  function renderSidebar(currentChapter) {
    const completedChapters = chapters.filter((chapter) => isChapterComplete(chapter.id)).length;
    document.getElementById("chapterProgressText").textContent = `${completedChapters} / ${chapters.length}`;
    document.getElementById("currentChapterLabel").textContent = currentChapter.title;
    document.getElementById("topbarTitle").textContent = currentChapter.title;

    document.getElementById("chapterNav").innerHTML = chapters
      .map((chapter) => {
        const progress = getChapterProgress(chapter.id);
        const complete = isChapterComplete(chapter.id);
        return `
          <button
            class="nav-item ${chapter.id === currentChapter.id ? "is-active" : ""} ${complete ? "is-complete" : ""}"
            type="button"
            data-action="switch-chapter"
            data-chapter-id="${chapter.id}"
          >
            <div class="nav-line">
              <strong>${chapter.title}</strong>
              <span class="nav-status"></span>
            </div>
            <div class="nav-detail">${progress.completed} / 3 大题完成</div>
          </button>
        `;
      })
      .join("");
  }

  function renderMain(chapter, chapterState) {
    const matchingResult = evaluateMatching(chapter, chapterState);
    const choicesResult = evaluateChoices(chapter, chapterState);
    const testResult = evaluateTest(chapter, chapterState);

    document.getElementById("mainContent").innerHTML = `
      ${renderHero(chapter, matchingResult, choicesResult, testResult)}
      ${renderParaphrases(chapter)}
      ${renderMatching(chapter, chapterState, matchingResult)}
      ${renderChoices(chapter, chapterState, choicesResult)}
      ${renderTest(chapter, chapterState, testResult)}
    `;
  }

  function renderHero(chapter, matchingResult, choicesResult, testResult) {
    const totalTerms = chapter.paraphrases.reduce((sum, item) => sum + item.allTerms.length, 0);
    const completedSections = [matchingResult.isComplete, choicesResult.isComplete, testResult.isComplete].filter(Boolean)
      .length;

    return `
      <section class="hero-card">
        <div>
          <p class="eyebrow">List Overview</p>
          <h2>${chapter.title} 学习面板</h2>
          <p class="section-helper">先按词汇脉络看同义词链，再做题。拖拽区已经贴近题目，拖动到页面上下边缘时会自动滚动。</p>
        </div>

        <div class="hero-grid">
          <div class="hero-stat">
            <span class="summary-label">词汇组数</span>
            <strong>${chapter.paraphrases.length}</strong>
          </div>
          <div class="hero-stat">
            <span class="summary-label">覆盖词项</span>
            <strong>${totalTerms}</strong>
          </div>
          <div class="hero-stat">
            <span class="summary-label">完成题块</span>
            <strong>${completedSections} / 3</strong>
          </div>
        </div>

        <div class="hero-tags">
          <div class="hero-tag">匹配题：${matchingResult.correctCount} / ${chapter.matching.prompts.length}</div>
          <div class="hero-tag">选择题：${choicesResult.correctCount} / ${chapter.choices.length}</div>
          <div class="hero-tag">归类题：${testResult.correctCount} / ${chapter.testYourself.length}</div>
        </div>
      </section>
    `;
  }

  function renderParaphrases(chapter) {
    const cards = chapter.paraphrases
      .map(
        (item) => `
          <article class="paraphrase-card">
            <div class="paraphrase-head">
              <span class="paraphrase-number">${item.order}</span>
              <div>
                <strong>${escapeHtml(item.headword)}</strong>
                <div class="question-caption">${item.partOfSpeech || "词性未标注"}</div>
              </div>
            </div>
            <div class="paraphrase-chain">
              ${item.allTerms.map((term) => `<span class="term-chip">${escapeHtml(term)}</span>`).join("")}
            </div>
            <div class="paraphrase-meta">${escapeHtml(item.meaningZh)}</div>
          </article>
        `,
      )
      .join("");

    return `
      <section class="section-card" id="paraphrases">
        <div class="section-header">
          <div>
            <p class="eyebrow">Section 1</p>
            <h3>Paraphrases</h3>
            <p class="section-helper">每组词按“主词 → 同义词链 → 中文义项”展开，先建立脉络再做题。</p>
          </div>
          <div class="status-chip is-success">知识点已完整展示</div>
        </div>
        <div class="paraphrase-grid">${cards}</div>
      </section>
    `;
  }

  function renderMatching(chapter, chapterState, result) {
    const placedOptions = new Set(Object.values(chapterState.matching.placements).filter(Boolean));
    const bank = chapter.matching.options.filter((option) => !placedOptions.has(option.id));

    const rows = chapter.matching.prompts
      .map((prompt) => {
        const placedId = chapterState.matching.placements[prompt.id];
        const placedOption = chapter.matching.options.find((option) => option.id === placedId);
        const rowState = chapterState.matching.checked
          ? result.promptResults[prompt.id]
            ? "is-success"
            : "is-error"
          : "";

        return `
          <div class="matching-item">
            <div class="matching-row">
              <div class="matching-prompt"><strong>${prompt.number}.</strong> ${escapeHtml(prompt.text)}</div>
              <div class="drop-target ${rowState}" data-drop-type="matching-slot" data-prompt-id="${prompt.id}">
                ${
                  placedOption
                    ? renderDraggableCard("matching-option", placedOption.id, placedOption.text)
                    : '<span class="empty-copy">把选项拖到这里</span>'
                }
              </div>
            </div>
            ${
              chapterState.matching.checked && !result.promptResults[prompt.id]
                ? `<div class="correct-answer">正确答案：${escapeHtml(prompt.correctAnswerText)}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    return `
      <section class="section-card" id="matching">
        <div class="section-header">
          <div>
            <p class="eyebrow">Section 2</p>
            <h3>Matching Practice</h3>
            <p class="section-helper">按题目原样完成拖拽配对。右侧选项池会固定在附近，减少拖动距离。</p>
          </div>
          <div class="section-actions">
            ${renderSectionStatus(result.isComplete, chapterState.matching.checked, "已完成", "待检查")}
            <button class="accent-button glass-button" type="button" data-action="check-matching">Check</button>
          </div>
        </div>

        ${chapterState.matching.checked ? renderResultBanner(result) : ""}

        <div class="interactive-layout">
          <div class="interactive-main">
            <div class="matching-grid">${rows}</div>
          </div>
          <aside class="interactive-bank">
            <div class="bank-panel sticky-bank">
              <div class="bank-header">
                <strong>Options</strong>
                <span class="question-caption">${bank.length} remaining</span>
              </div>
              <div class="term-bank compact-bank" data-drop-type="matching-bank">
                ${
                  bank.length
                    ? bank.map((option) => renderDraggableCard("matching-option", option.id, option.text)).join("")
                    : '<span class="empty-copy">所有选项都已放置。</span>'
                }
              </div>
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  function renderChoices(chapter, chapterState, result) {
    const cards = chapter.choices
      .map((choice) => {
        const selected = chapterState.choices.answers[choice.id];
        const choiceResult = result.choiceResults[choice.id];

        return `
          <article class="choice-card">
            <div class="question-card-header">
              <strong>${choice.number}. ${escapeHtml(choice.question)}</strong>
              <span class="question-caption">单选题</span>
            </div>
            <div class="choice-options">
              ${choice.options
                .map((option) => {
                  const classes = ["choice-option"];
                  if (selected === option.id) classes.push("is-selected");
                  if (chapterState.choices.checked && option.id === choice.correctOption) classes.push("is-correct");
                  if (
                    chapterState.choices.checked &&
                    selected === option.id &&
                    selected !== choice.correctOption
                  ) {
                    classes.push("is-wrong");
                  }

                  return `
                    <button
                      class="${classes.join(" ")}"
                      type="button"
                      data-action="select-choice"
                      data-question-id="${choice.id}"
                      data-option-id="${option.id}"
                    >
                      <strong>${option.id}.</strong> ${escapeHtml(option.text)}
                    </button>
                  `;
                })
                .join("")}
            </div>
            ${
              chapterState.choices.checked && !choiceResult
                ? `<div class="correct-answer">正确答案：${escapeHtml(choice.correctOption)}. ${escapeHtml(
                    getChoiceOptionText(choice, choice.correctOption),
                  )}</div>`
                : ""
            }
          </article>
        `;
      })
      .join("");

    return `
      <section class="section-card" id="choices">
        <div class="section-header">
          <div>
            <p class="eyebrow">Section 3</p>
            <h3>Choices</h3>
            <p class="section-helper">选择题保持原样，做完后点 Check 即可显示对错和正确答案。</p>
          </div>
          <div class="section-actions">
            ${renderSectionStatus(result.isComplete, chapterState.choices.checked, "已完成", "待检查")}
            <button class="accent-button glass-button" type="button" data-action="check-choices">Check</button>
          </div>
        </div>

        ${chapterState.choices.checked ? renderResultBanner(result) : ""}
        <div class="choice-list">${cards}</div>
      </section>
    `;
  }

  function renderTest(chapter, chapterState, result) {
    const termCatalog = getTermCatalog(chapter);
    const placedTermIds = new Set(
      Object.values(chapterState.test.placements).flatMap((value) => (Array.isArray(value) ? value : [])),
    );
    const bankTerms = termCatalog.filter((term) => !placedTermIds.has(term.id));

    const targets = chapter.testYourself
      .map((item) => {
        const assignedTerms = (chapterState.test.placements[item.id] || []).map((termId) =>
          termCatalog.find((term) => term.id === termId),
        );
        const targetState = chapterState.test.checked
          ? result.targetResults[item.id]
            ? "is-success"
            : "is-error"
          : "";

        return `
          <div class="test-target">
            <div class="test-target-header">
              <strong>${item.number}. ${escapeHtml(item.promptZh)}</strong>
              <span class="question-caption">${item.acceptedAnswers.length} 个词项</span>
            </div>
            <div class="drop-target ${targetState}" data-drop-type="test-slot" data-target-id="${item.id}">
              ${
                assignedTerms.length
                  ? assignedTerms.filter(Boolean).map((term) => renderDraggableCard("test-term", term.id, term.text)).join("")
                  : '<span class="empty-copy">把对应单词拖到这里</span>'
              }
            </div>
            ${
              chapterState.test.checked && !result.targetResults[item.id]
                ? `<div class="test-answer-list">${item.acceptedAnswers
                    .map((answer) => `<span class="test-answer-chip">${escapeHtml(answer)}</span>`)
                    .join("")}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    return `
      <section class="section-card" id="test">
        <div class="section-header">
          <div>
            <p class="eyebrow">Section 4</p>
            <h3>Test Yourself</h3>
            <p class="section-helper">拖拽归类时，右侧词库也会固定在附近；拖到页面边缘时会自动滚动。</p>
          </div>
          <div class="section-actions">
            ${renderSectionStatus(result.isComplete, chapterState.test.checked, "已完成", "待检查")}
            <button class="accent-button glass-button" type="button" data-action="check-test">Check</button>
          </div>
        </div>

        ${chapterState.test.checked ? renderResultBanner(result) : ""}

        <div class="interactive-layout">
          <div class="interactive-main">
            <div class="test-grid">${targets}</div>
          </div>
          <aside class="interactive-bank">
            <div class="bank-panel sticky-bank">
              <div class="bank-header">
                <strong>Word Bank</strong>
                <span class="question-caption">${bankTerms.length} remaining</span>
              </div>
              <div class="term-bank compact-bank" data-drop-type="test-bank">
                ${
                  bankTerms.length
                    ? bankTerms.map((term) => renderDraggableCard("test-term", term.id, term.text)).join("")
                    : '<span class="empty-copy">所有单词都已放置，点 Check 检查答案。</span>'
                }
              </div>
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  function renderSectionStatus(isComplete, isChecked, completeText, pendingText) {
    if (isComplete) {
      return `<span class="status-chip is-success">${completeText}</span>`;
    }
    if (isChecked) {
      return '<span class="status-chip is-warning">有错误，已显示答案</span>';
    }
    return `<span class="status-chip">${pendingText}</span>`;
  }

  function renderResultBanner(result) {
    return `
      <div class="result-banner ${result.isComplete ? "is-success" : "is-error"}">
        <strong>${result.isComplete ? "全部正确" : "还有错误需要重做"}</strong>
        <span>${result.correctCount} / ${result.totalCount} 正确</span>
      </div>
    `;
  }

  function renderDraggableCard(kind, id, text) {
    const picked = uiState.picked && uiState.picked.kind === kind && uiState.picked.id === id;
    return `
      <div
        class="drag-card ${picked ? "is-picked" : ""}"
        draggable="false"
        data-kind="${kind}"
        data-id="${id}"
      >
        <span>${escapeHtml(text)}</span>
      </div>
    `;
  }

  function renderSettings(currentChapter) {
    if (!uiState.resetSelection.size) {
      uiState.resetSelection.add(currentChapter.id);
    }

    document.getElementById("settingsList").innerHTML = chapters
      .map((chapter) => {
        const checked = uiState.resetSelection.has(chapter.id);
        return `
          <div class="settings-item">
            <label>
              <input
                type="checkbox"
                data-action="toggle-reset-chapter"
                data-chapter-id="${chapter.id}"
                ${checked ? "checked" : ""}
              />
              <span>${chapter.title}</span>
            </label>
            <span class="question-caption">${getChapterProgress(chapter.id).completed} / 3 完成</span>
          </div>
        `;
      })
      .join("");

    document.getElementById("settingsPanel").hidden = !uiState.isSettingsOpen;
    document.getElementById("backdrop").hidden = !uiState.isSettingsOpen && !(mobileQuery.matches && isSidebarOpen());
  }

  function syncShellUi() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("backdrop");
    const collapseDesktop = state.sidebarCollapsed && !mobileQuery.matches;

    sidebar.classList.toggle("is-collapsed", collapseDesktop);
    sidebar.classList.toggle("is-open", mobileQuery.matches && isSidebarOpen());
    document.body.style.overflow = uiState.isSettingsOpen ? "hidden" : "";
    backdrop.hidden = !uiState.isSettingsOpen && !(mobileQuery.matches && isSidebarOpen());
  }

  function handleClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    const action = actionTarget?.dataset.action;
    const dragCard = event.target.closest(".drag-card");
    const dropTarget = event.target.closest("[data-drop-type]");

    if (dragCard) {
      handleCardClick(dragCard);
      render();
      return;
    }

    if (dropTarget && uiState.picked) {
      handleDropZoneClick(dropTarget);
      render();
      return;
    }

    if (action === "switch-chapter") {
      state.currentChapterId = actionTarget.dataset.chapterId;
      if (mobileQuery.matches) {
        state.sidebarCollapsed = true;
      }
      render();
      return;
    }

    if (action === "check-matching") {
      getChapterState(state.currentChapterId).matching.checked = true;
      render();
      return;
    }

    if (action === "check-choices") {
      getChapterState(state.currentChapterId).choices.checked = true;
      render();
      return;
    }

    if (action === "check-test") {
      getChapterState(state.currentChapterId).test.checked = true;
      render();
      return;
    }

    if (action === "select-choice") {
      const chapterState = getChapterState(state.currentChapterId);
      chapterState.choices.answers[actionTarget.dataset.questionId] = actionTarget.dataset.optionId;
      chapterState.choices.checked = false;
      render();
      return;
    }

    if (event.target.closest("#settingsButton")) {
      uiState.isSettingsOpen = true;
      render();
      return;
    }

    if (event.target.closest("#closeSettingsButton") || event.target.closest("#backdrop")) {
      closePanels();
      render();
      return;
    }

    if (event.target.closest("#resetSelectedButton")) {
      resetChapters([...uiState.resetSelection]);
      render();
      return;
    }

    if (event.target.closest("#resetCurrentButton")) {
      resetChapters([state.currentChapterId]);
      render();
      return;
    }

    if (event.target.closest("#resetAllButton")) {
      resetChapters(chapters.map((chapter) => chapter.id));
      render();
      return;
    }

    if (event.target.closest("#selectCurrentButton")) {
      uiState.resetSelection = new Set([state.currentChapterId]);
      render();
      return;
    }

    if (event.target.closest("#selectAllButton")) {
      uiState.resetSelection = new Set(chapters.map((chapter) => chapter.id));
      render();
      return;
    }

    if (event.target.closest("#clearSelectionButton")) {
      uiState.resetSelection = new Set();
      render();
      return;
    }

    if (event.target.closest("#sidebarCollapseButton")) {
      state.sidebarCollapsed = true;
      render();
      return;
    }

    if (event.target.closest("#sidebarOpenButton")) {
      state.sidebarCollapsed = false;
      render();
      return;
    }

    if (event.target.closest("#scrollTopButton")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleCardClick(card) {
    const kind = card.dataset.kind;
    const id = card.dataset.id;
    const parentDropType = card.parentElement?.dataset.dropType || "";

    if (uiState.picked && uiState.picked.kind === kind && uiState.picked.id === id) {
      uiState.picked = null;
      return;
    }

    if (kind === "matching-option") {
      const chapterState = getChapterState(state.currentChapterId);
      Object.keys(chapterState.matching.placements).forEach((key) => {
        if (chapterState.matching.placements[key] === id) {
          chapterState.matching.placements[key] = null;
        }
      });
      chapterState.matching.checked = false;
      uiState.picked = { kind, id };
      if (parentDropType === "matching-bank") {
        uiState.picked = { kind, id };
      }
      return;
    }

    if (kind === "test-term") {
      const chapterState = getChapterState(state.currentChapterId);
      Object.keys(chapterState.test.placements).forEach((key) => {
        chapterState.test.placements[key] = chapterState.test.placements[key].filter((value) => value !== id);
      });
      chapterState.test.checked = false;
      uiState.picked = { kind, id };
    }
  }

  function handleDropZoneClick(target) {
    if (!uiState.picked) return;

    if (uiState.picked.kind === "matching-option") {
      if (target.dataset.dropType === "matching-slot") {
        handleMatchingDrop(uiState.picked.id, target);
      }
      uiState.picked = null;
      return;
    }

    if (uiState.picked.kind === "test-term") {
      if (target.dataset.dropType === "test-slot") {
        handleTestDrop(uiState.picked.id, target);
      }
      uiState.picked = null;
    }
  }

  function handleChange(event) {
    const checkbox = event.target.closest('[data-action="toggle-reset-chapter"]');
    if (!checkbox) return;

    if (checkbox.checked) {
      uiState.resetSelection.add(checkbox.dataset.chapterId);
    } else {
      uiState.resetSelection.delete(checkbox.dataset.chapterId);
    }
  }

  function handleMatchingDrop(optionId, target) {
    const chapterState = getChapterState(state.currentChapterId);
    const placements = chapterState.matching.placements;

    Object.keys(placements).forEach((key) => {
      if (placements[key] === optionId) {
        placements[key] = null;
      }
    });

    if (target.dataset.dropType === "matching-slot") {
      placements[target.dataset.promptId] = optionId;
    }

    chapterState.matching.checked = false;
  }

  function handleTestDrop(termId, target) {
    const chapterState = getChapterState(state.currentChapterId);
    const placements = chapterState.test.placements;

    Object.keys(placements).forEach((key) => {
      placements[key] = placements[key].filter((value) => value !== termId);
    });

    if (target.dataset.dropType === "test-slot") {
      placements[target.dataset.targetId].push(termId);
    }

    chapterState.test.checked = false;
  }

  function closePanels() {
    uiState.isSettingsOpen = false;
    if (mobileQuery.matches) {
      state.sidebarCollapsed = true;
    }
  }

  function isSidebarOpen() {
    return !state.sidebarCollapsed;
  }

  function resetChapters(chapterIds) {
    chapterIds.forEach((chapterId) => {
      const chapter = chapters.find((item) => item.id === chapterId);
      if (chapter) {
        state.chapters[chapterId] = createEmptyChapterState(chapter);
      }
    });
    uiState.isSettingsOpen = false;
  }

  function evaluateMatching(chapter, chapterState) {
    const promptResults = {};
    let correctCount = 0;

    chapter.matching.prompts.forEach((prompt) => {
      const isCorrect = chapterState.matching.placements[prompt.id] === prompt.correctOptionId;
      promptResults[prompt.id] = isCorrect;
      if (isCorrect) correctCount += 1;
      prompt.correctAnswerText =
        chapter.matching.options.find((option) => option.id === prompt.correctOptionId)?.text || "";
    });

    return {
      totalCount: chapter.matching.prompts.length,
      correctCount,
      isComplete: chapterState.matching.checked && correctCount === chapter.matching.prompts.length,
      promptResults,
    };
  }

  function evaluateChoices(chapter, chapterState) {
    const choiceResults = {};
    let correctCount = 0;

    chapter.choices.forEach((choice) => {
      const isCorrect = chapterState.choices.answers[choice.id] === choice.correctOption;
      choiceResults[choice.id] = isCorrect;
      if (isCorrect) correctCount += 1;
    });

    return {
      totalCount: chapter.choices.length,
      correctCount,
      isComplete: chapterState.choices.checked && correctCount === chapter.choices.length,
      choiceResults,
    };
  }

  function evaluateTest(chapter, chapterState) {
    const catalog = getTermCatalog(chapter);
    const targetResults = {};
    let correctCount = 0;

    chapter.testYourself.forEach((item) => {
      const placed = [...(chapterState.test.placements[item.id] || [])].sort();
      const expected = catalog
        .filter((term) => term.targetId === item.id)
        .map((term) => term.id)
        .sort();
      const isCorrect = placed.length === expected.length && placed.every((value, index) => value === expected[index]);
      targetResults[item.id] = isCorrect;
      if (isCorrect) correctCount += 1;
    });

    return {
      totalCount: chapter.testYourself.length,
      correctCount,
      isComplete: chapterState.test.checked && correctCount === chapter.testYourself.length,
      targetResults,
    };
  }

  function getTermCatalog(chapter) {
    return chapter.testYourself.flatMap((item) =>
      item.acceptedAnswers.map((term, termIndex) => ({
        id: `${item.id}-${termIndex}`,
        text: term,
        targetId: item.id,
      })),
    );
  }

  function getChoiceOptionText(choice, optionId) {
    return choice.options.find((option) => option.id === optionId)?.text || "";
  }

  function getChapterProgress(chapterId) {
    const chapter = chapters.find((item) => item.id === chapterId);
    const chapterState = getChapterState(chapterId);
    const matching = evaluateMatching(chapter, chapterState).isComplete;
    const choices = evaluateChoices(chapter, chapterState).isComplete;
    const test = evaluateTest(chapter, chapterState).isComplete;
    return {
      completed: [matching, choices, test].filter(Boolean).length,
    };
  }

  function isChapterComplete(chapterId) {
    return getChapterProgress(chapterId).completed === 3;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
