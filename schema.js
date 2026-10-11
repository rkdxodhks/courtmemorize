/**
 * ==============================================================================
 * LawTyping External Schema Architecture Engine (법원직 조문 암기 외부 스키마 엔진)
 * ==============================================================================
 * 
 * [3-Tier Schema Architecture / ANSI-SPARC Standard]
 * 1. Internal Schema (내부 스키마):
 *    - data.js의 비정형 원문 텍스트 (줄바꿈, 괄호 한자, 특수기호 혼재)
 * 2. Conceptual Schema (개념 스키마):
 *    - 법률 조문 도메인 모델 (Law > Part > Chapter > Section > Article > Clause > Item > Proviso > Token)
 * 3. External Schema (외부 스키마 / View Models):
 *    - TranscriptionExternalSchema (필사 뷰 프로젝션: FocusZone + 항별 토큰 스트림 + 타이포 위계)
 *    - ClozeArcadeExternalSchema   (빈칸 뷰 프로젝션: 4대 급소 블랭크 + 초성/4지선다 스캐폴딩 + 타임어택)
 *    - ScopeTreeExternalSchema     (탐색 뷰 프로젝션: 법령 체계 트리 & 빈출 프리셋)
 *    - DiagnosticExternalSchema    (리포트 뷰 프로젝션: 인출 레이턴시 + 취약 조문 큐)
 */

(function (global) {
  'use strict';

  // ============================================================================
  // 1. 도메인 어휘 및 4대 출제 급소 디스트랙터(오답 선지) 분류 사전 (Taxonomy Bank)
  // ============================================================================
  const LEGAL_TAXONOMY = {
    EFFECT: [
      '무효로 한다', '취소할 수 있다', '각하하여야 한다', '기각하여야 한다',
      '유효로 본다', '추인한 것으로 본다', '대항하지 못한다', '손해를 배상하여야 한다',
      '효력을 잃는다', '소멸한다', '이행을 거절할 수 있다', '해제할 수 있다',
      '취소하지 못한다', '지급을 청구할 수 있다', '면하지 못한다'
    ],
    PERIOD_NUMBER: [
      '1개월', '2주일', '3주일', '1년', '3년', '5년', '10년', '20년',
      '과반수', '3분의 2 이상', '4분의 3 이상', '전원 일치', '19세', '30일', '14일'
    ],
    JURISDICTION: [
      '보통재판적', '특별재판적', '합의관할', '변론관할', '전속관할',
      '수소법원', '집행법원', '가정법원', '주무관청', '등기소', '관할법원'
    ],
    REQUIREMENT: [
      '선의의 제3자', '악의의 제3자', '과실없이', '중대한 과실로',
      '정당한 사유', '신의성실에 좇아', '선량한 관리자의 주의', '직권으로',
      '이해관계인의 청구', '본인의 의사에 반하여', '법원의 허가', '법정대리인의 동의'
    ]
  };

  // 한글 초성 분해 배열
  const CHOSUNG_LIST = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];

  function extractChosung(str) {
    if (!str) return '';
    let result = '';
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i) - 44032;
      if (code >= 0 && code <= 11171) {
        result += CHOSUNG_LIST[Math.floor(code / 588)];
      } else {
        result += str[i];
      }
    }
    return result;
  }

  // ============================================================================
  // 2. LawSchemaParser (내부 스키마 -> 개념 스키마 파서)
  // ============================================================================
  const LawSchemaParser = {
    // 괄호 한자 및 불필요 특수문자 제거
    cleanHanja(rawText) {
      if (!rawText) return '';
      return rawText
        .replace(/\([一-龥ㆍ\s,/·0-9]+\)/g, '') // 괄호 속 한자 (訴) 등
        .replace(/[一-龥]/g, '')                 // 단독 한자
        .trim();
    },

    // 조문 원문을 항(Clause)과 호(Item)로 정밀 분해
    parseToConceptualArticle(rawArticle) {
      if (!rawArticle) return null;

      const rawContent = rawArticle.content || '';
      // 줄 단위 분리
      const rawLines = rawContent.split('\n').map(l => l.trim()).filter(Boolean);

      const parsedClauses = [];
      let currentClause = {
        clauseNo: 1,
        clauseMarker: '', // '①', '②' or ''
        clauseTitle: '본문',
        rawLines: []
      };

      const clauseMarkerRegex = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/;
      const itemMarkerRegex = /^[0-9]+\\\.\s*|^[0-9]+\.\s*/;

      if (rawLines.length === 0) {
        // 비어있는 경우
        parsedClauses.push({
          clauseNo: 1,
          clauseMarker: '',
          clauseTitle: '본문',
          rawText: ''
        });
      } else {
        rawLines.forEach((line) => {
          const cMatch = line.match(clauseMarkerRegex);
          if (cMatch) {
            // 새 항 시작
            const marker = cMatch[0];
            const num = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'.indexOf(marker) + 1;
            currentClause = {
              clauseNo: num > 0 ? num : (parsedClauses.length + 1),
              clauseMarker: marker,
              clauseTitle: `제${num}항`,
              rawLines: [line.substring(marker.length).trim()]
            };
            parsedClauses.push(currentClause);
          } else {
            // 항 번호가 없는 첫 줄이거나 이전 항에 속한 호/문장
            if (parsedClauses.length === 0) {
              currentClause = {
                clauseNo: 1,
                clauseMarker: '',
                clauseTitle: '본문',
                rawLines: [line]
              };
              parsedClauses.push(currentClause);
            } else {
              currentClause.rawLines.push(line);
            }
          }
        });
      }

      // 각 항을 문맥 토큰으로 세부 파싱
      const structuredClauses = parsedClauses.map((c, cIdx) => {
        const fullClauseText = c.rawLines.join(' ');
        const cleanedClauseText = this.cleanHanja(fullClauseText);
        const rawWords = cleanedClauseText.split(/\s+/).filter(Boolean);

        let isInProviso = false;

        const tokens = rawWords.map((word, wIdx) => {
          // 단서 판별
          if (/^다만[,.]?$|^그러나[,.]?$/.test(word)) {
            isInProviso = true;
          }

          // 타이핑 대상 정제 (한글, 영문, 숫자만 남기고 문장부호 제거)
          const typeTarget = word.replace(/[.,·~"'`\(\)\[\]{}<>:;!?]/g, '');

          // 토큰 역할 가중치 판정
          let role = 'connector';
          if (isInProviso) {
            role = 'proviso';
          } else if (this.isStatutoryKeyword(word)) {
            role = 'keyword';
          }

          return {
            tokenId: `${rawArticle.id}_c${c.clauseNo}_w${wIdx}`,
            clauseIndex: cIdx,
            clauseNo: c.clauseNo,
            wordIndex: wIdx,
            rawWord: word,
            cleanDisplay: word,
            typeTarget: typeTarget,
            isProviso: isInProviso,
            role: role,
            isPunctuationOnly: typeTarget.length === 0
          };
        });

        return {
          clauseIndex: cIdx,
          clauseNo: c.clauseNo,
          clauseMarker: c.clauseMarker,
          clauseTitle: c.clauseTitle,
          text: cleanedClauseText,
          tokens: tokens
        };
      });

      return {
        id: rawArticle.id,
        law: rawArticle.law || (rawArticle.id.startsWith('civ_') ? '민법' : '민사소송법'),
        part: rawArticle.part || '',
        chapter: rawArticle.chapter || '',
        section: rawArticle.section || '',
        artNo: rawArticle.artNo || '',
        artInt: rawArticle.artInt || 0,
        title: rawArticle.title || '',
        isKey: !!rawArticle.isKey,
        clauses: structuredClauses
      };
    },

    // 법률 핵심 키워드 판별
    isStatutoryKeyword(word) {
      const clean = word.replace(/[.,·~"'`\(\)\[\]{}<>:;!?]/g, '');
      if (clean.length < 2) return false;

      // 1. 법률효과
      if (/무효|취소|각하|기각|유효|추인|해제|소멸|배상|제한|대항하지|이행|책임/.test(clean)) return true;
      // 2. 주체/객체/관할
      if (/재판적|관할|법원|법정대리인|후견인|채권자|채무자|제삼자|제3자|주무관청|사원|이사|청산인/.test(clean)) return true;
      // 3. 요건
      if (/선의|악의|과실|정당한|신의|사유|의사표시|권리|의무|능력|점유|소유|담보/.test(clean)) return true;
      // 4. 숫자/기간
      if (/[0-9]+[년월일세분회주]|과반수|3분의/.test(clean)) return true;

      return false;
    }
  };

  // ============================================================================
  // 3. ExternalSchemaProjector (개념 스키마 -> 외부 스키마 프로젝터)
  // ============================================================================
  const ExternalSchemaProjector = {
    // --------------------------------------------------------------------------
    // A. 정독 필사 외부 스키마 (TranscriptionExternalSchema)
    // --------------------------------------------------------------------------
    projectToTranscriptionSchema(conceptualArticle, currentClauseIndex = 0, sessionMeta = {}) {
      if (!conceptualArticle) return null;

      const activeClause = conceptualArticle.clauses[currentClauseIndex] || conceptualArticle.clauses[0] || {
        clauseTitle: '본문',
        clauseMarker: ''
      };

      // 1. 시선 집중 구역(Focus Zone) 헤더 메타데이터
      const focusZone = {
        lawSubject: conceptualArticle.law,
        articleNo: conceptualArticle.artNo,
        clauseBadge: activeClause.clauseMarker 
          ? `${activeClause.clauseMarker} ${activeClause.clauseTitle}` 
          : activeClause.clauseTitle,
        articleTitle: conceptualArticle.title ? `(${conceptualArticle.title})` : '',
        isKey: conceptualArticle.isKey,
        importanceGrade: conceptualArticle.isKey ? 'A' : 'B',
        pathBreadcrumb: [conceptualArticle.part, conceptualArticle.chapter, conceptualArticle.section].filter(Boolean).join(' > '),
        progressText: sessionMeta.currentIndex !== undefined 
          ? `${sessionMeta.currentIndex + 1} / ${sessionMeta.totalCount} 조문` 
          : ''
      };

      // 2. 전체 단어 플랫 스트림 (항간 이동 감지 및 인덱싱)
      const allTokens = [];
      conceptualArticle.clauses.forEach((c) => {
        c.tokens.forEach((tok) => {
          allTokens.push({
            ...tok,
            clauseMarker: c.clauseMarker,
            clauseTitle: c.clauseTitle,
            globalWordIndex: allTokens.length
          });
        });
      });

      return {
        articleId: conceptualArticle.id,
        focusZone: focusZone,
        clauses: conceptualArticle.clauses,
        flatTokens: allTokens,
        totalWordCount: allTokens.length
      };
    },

    // --------------------------------------------------------------------------
    // B. 빈칸 인출 아케이드 외부 스키마 (ClozeArcadeExternalSchema)
    // --------------------------------------------------------------------------
    projectToClozeArcadeSchema(conceptualArticle, difficulty = 'balanced', sessionMeta = {}) {
      if (!conceptualArticle) return null;

      const transSchema = this.projectToTranscriptionSchema(conceptualArticle, 0, sessionMeta);
      const allTokens = transSchema.flatTokens;

      // 빈칸 후보군 추출 (법률 키워드 우선)
      const candidateTokens = allTokens.filter(tok => 
        !tok.isPunctuationOnly && 
        tok.typeTarget.length >= 2 &&
        tok.role === 'keyword'
      );

      // 키워드가 부족할 경우 일반 단어 보충
      let targetTokens = candidateTokens;
      if (targetTokens.length === 0) {
        targetTokens = allTokens.filter(tok => !tok.isPunctuationOnly && tok.typeTarget.length >= 2);
      }

      // 조문당 최대 2~4개 빈칸 선정 (균형 인출)
      const maxBlanks = Math.max(1, Math.min(4, Math.floor(allTokens.length * 0.25)));
      // 간격을 두어 고르게 선정
      const selectedTokens = [];
      const step = Math.max(1, Math.floor(targetTokens.length / maxBlanks));
      for (let i = 0; i < targetTokens.length && selectedTokens.length < maxBlanks; i += step) {
        selectedTokens.push(targetTokens[i]);
      }

      const blankMap = new Map();
      const blanks = selectedTokens.map((tok, bIdx) => {
        const cleanAnswer = tok.typeTarget;
        const chosung = extractChosung(cleanAnswer);
        const category = this.categorizeBlank(cleanAnswer);
        const choices = this.generateDistractors(cleanAnswer, category);

        const blankEntity = {
          blankId: `blank_${tok.tokenId}`,
          globalWordIndex: tok.globalWordIndex,
          clauseIndex: tok.clauseIndex,
          clauseNo: tok.clauseNo,
          targetAnswer: tok.rawWord,
          cleanAnswer: cleanAnswer,
          category: category,
          scaffolding: {
            level1Chosung: chosung,
            level2Choices: choices.choices,
            correctChoiceIndex: choices.correctIndex
          },
          timeAttackSeconds: 7.0
        };

        blankMap.set(tok.globalWordIndex, blankEntity);
        return blankEntity;
      });

      // 렌더링용 토큰 리스트 구성
      const displayTokens = allTokens.map((tok) => {
        const blank = blankMap.get(tok.globalWordIndex);
        return {
          ...tok,
          isBlank: !!blank,
          blankEntity: blank || null
        };
      });

      return {
        articleId: conceptualArticle.id,
        focusZone: transSchema.focusZone,
        blanks: blanks,
        blankCount: blanks.length,
        displayTokens: displayTokens,
        allTokens: allTokens
      };
    },

    // 빈칸 단어의 법률 카테고리 판별
    categorizeBlank(cleanWord) {
      if (/무효|취소|각하|기각|유효|추인|해제|소멸|배상|제한|대항하지/.test(cleanWord)) return 'EFFECT';
      if (/[0-9]+[년월일세분회주]|과반수|3분의/.test(cleanWord)) return 'PERIOD_NUMBER';
      if (/재판적|관할|법원|등기소/.test(cleanWord)) return 'JURISDICTION';
      return 'REQUIREMENT';
    },

    // 4지선다 오답 선지(Distractor) 풀 생성기
    generateDistractors(correctAnswer, category) {
      const bank = LEGAL_TAXONOMY[category] || LEGAL_TAXONOMY.REQUIREMENT;
      // 정답과 다른 보기 추출
      const candidates = bank.filter(c => !c.includes(correctAnswer) && !correctAnswer.includes(c));

      // Fisher-Yates 셔플
      const shuffled = [...candidates].sort(() => 0.5 - Math.random());
      const chosenDistractors = shuffled.slice(0, 3);

      // 정답을 포함한 4개 선지 구성
      const allChoices = [...chosenDistractors, correctAnswer].sort(() => 0.5 - Math.random());
      const correctIndex = allChoices.indexOf(correctAnswer);

      return {
        choices: allChoices,
        correctIndex: correctIndex
      };
    },

    // --------------------------------------------------------------------------
    // C. 조문 계층 탐색 외부 스키마 (ScopeTreeExternalSchema)
    // --------------------------------------------------------------------------
    projectToScopeTreeSchema(rawLawList, activeSubject = 'civil') {
      const partsMap = new Map();

      rawLawList.forEach((raw) => {
        const partName = raw.part || '기타';
        const chapName = raw.chapter || '기타';

        if (!partsMap.has(partName)) {
          partsMap.set(partName, {
            partName: partName,
            chapters: new Map(),
            totalArticles: 0,
            keyArticles: 0
          });
        }

        const partObj = partsMap.get(partName);
        partObj.totalArticles++;
        if (raw.isKey) partObj.keyArticles++;

        if (!partObj.chapters.has(chapName)) {
          partObj.chapters.set(chapName, {
            chapterName: chapName,
            articles: []
          });
        }

        partObj.chapters.get(chapName).articles.push({
          id: raw.id,
          artNo: raw.artNo,
          artInt: raw.artInt,
          title: raw.title,
          isKey: !!raw.isKey,
          previewSnippet: LawSchemaParser.cleanHanja(raw.content).slice(0, 60) + '...'
        });
      });

      // 트리 배열로 변환
      const tree = Array.from(partsMap.values()).map(p => ({
        partName: p.partName,
        totalArticles: p.totalArticles,
        keyArticles: p.keyArticles,
        chapters: Array.from(p.chapters.values())
      }));

      return {
        subject: activeSubject,
        tree: tree,
        totalArticleCount: rawLawList.length
      };
    }
  };

  // ============================================================================
  // 글로벌 익스포트 (Browser & Node.js CommonJS 겸용)
  // ============================================================================
  const ExternalSchema = {
    Parser: LawSchemaParser,
    Projector: ExternalSchemaProjector,
    Taxonomy: LEGAL_TAXONOMY,
    extractChosung: extractChosung
  };

  global.LawExternalSchema = ExternalSchema;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExternalSchema;
  }

})(typeof window !== 'undefined' ? window : global);
