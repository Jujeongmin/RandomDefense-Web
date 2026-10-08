# 랜덤 디펜스 (Random Defense)

Verse8(Agent8) 플랫폼용 하이브리드 캐주얼 디펜스 게임. **TypeScript + Vite** 클라이언트와
**Agent8 GameServer**(`server/`)로 구성된다. 기획 의도·KPI·퍼블리싱 피치는 [`docs/GDD.md`](docs/GDD.md) 참고.

- 소환 → 합성 → 강화 → 배치로 사각 링을 도는 몹 웨이브를 막는다 (몹 100마리 누적 시 패배)
- **캠페인** 3챕터 × 10스테이지 (별 3개 도전, 첫 클리어 보상, 유닛 해금)
- **유닛 컬렉션** 8종 (기본 3 + 해금 5), 덱 4슬롯, 영구 레벨·퍽
- **PvP 실시간 1:1** (같은 웨이브를 동시에 막으며 몹을 보내 상대를 무너뜨림), 트로피·티어·시즌 패스·랭킹
- **무한 모드** 50웨이브 생존
- **수익화**: Verse8 VX Shop 결제 + Verse8 Ads(보상형/전면)

## 실행

```bash
npm install
npm run dev        # 개발 서버 (DEV 전용 디버그 버튼·가짜 광고 활성)
npm run typecheck  # 타입 검사
npm run build      # 타입검사 + 프로덕션 빌드 → dist/

# 게임 서버 (PvP/클라우드 저장/결제 지급)
cd server && npm install
npm run build && npm test   # gameserver-node 로컬 러너로 테스트 (isolated-vm)

# 밸런스 시뮬레이터
npx tsx tools/simulate.ts 20          # 무한 모드: 연구 진척별 도달 웨이브
npx tsx tools/simulate.ts stages 8    # 캠페인: 스테이지별 클리어율/별 (연구 × 유닛 레벨)
SIM_HPG=0.12 npx tsx tools/simulate.ts 20   # HP 성장률 실험
```

`VITE_AGENT8_VERSE` 가 없으면 **오프라인 모드**: localStorage 저장, 데모 VX(1000)로 결제 흉내,
PvP 는 AI 연습전만 가능. Verse8 프로젝트(.env 에 `VITE_AGENT8_VERSE`)에서는 자동으로
게임서버·VX Shop·Ads 가 활성화된다.

## 프로젝트 구조

```
├── game/                    # Vite 루트 (index.html)
│   ├── public/{sprites,tiles}
│   └── src/
│       ├── main.ts          # 부팅(플랫폼 init → 클라우드 메타 → 미지급 결제 동기화) / 판 흐름 / 루프
│       ├── engine.ts        # 게임 엔진 (웨이브·전투·스킬·합성·PvP 송수신·부활) - DOM 없음
│       ├── config.ts        # 모든 데이터/밸런스 (유닛·스킬·스테이지·상품·시즌패스·PvP)
│       ├── progress.ts      # 캠페인 진행·유닛 해금/레벨·덱·기능 해금
│       ├── shop.ts          # 결제 지급(중복 방지)·월정액·시즌패스 보상
│       ├── ads.ts           # @verse8/ads 보상형/전면 광고
│       ├── pvp.ts           # PvP 세션 (온라인 룸 / AI 봇) 공통 인터페이스
│       ├── ai.ts            # 봇 플레이 정책
│       ├── net/server.ts    # @agent8/gameserver 연결 (GS/RS 호출)
│       ├── platform.ts      # LocalPlatform / Verse8Platform (저장·결제 추상화)
│       ├── menu.ts          # 로비와 모든 메타 패널
│       ├── ui.ts            # 게임 화면 HUD/영웅관리/PvP HUD/결과/튜토리얼
│       ├── render.ts        # 캔버스 렌더러 (투사체·파티클·화면흔들림·보스바)
│       ├── assets.ts        # 스프라이트 로더 + 해금 유닛 색조 변형 시트 생성
│       ├── audio.ts         # WebAudio 합성 효과음 + 트랙별 BGM(메뉴/전투/보스/PvP)
│       ├── meta.ts / types.ts / dom.ts / style.css
├── server/                  # Agent8 GameServer (server/src/server.ts, test/)
├── tools/simulate.ts        # 헤드리스 밸런스 시뮬레이터
└── docs/GDD.md              # 게임 기획/퍼블리싱 문서
```

## Verse8 연동

### 1) 게임 서버 (`server/`)
`@agent8/gameserver-node` 형식(`export class Server`). 배포 시 Verse8 도구가
`npx -y @agent8/gameserver-node build` → `npx -y @agent8/deploy` 로 올린다.

| 함수 | 설명 |
| --- | --- |
| `loadProfile` / `saveProfile` | 계정 클라우드 저장 (pvp 필드는 서버 권위) |
| `$onItemPurchased(event)` | VX Shop 결제 완료 훅 → `pendingPurchases` 기록 |
| `claimPurchases` | 대기 구매를 가져가고 비움 (클라는 `purchaseId` 로 중복 지급 방지) |
| `pvpQueue` / `pvpPoll` / `pvpCancel` | 트로피 근접 매칭 (대기 시간에 따라 허용 폭 확대) |
| `pvpReady` / `pvpSnap` / `pvpAttack` / `pvpDefeat` | 룸: 동시 시작·상태 중계·몹 보내기·패배 보고 |
| `onRoomLeave` | 경기 중 이탈 → 상대 승리 |
| `pvpLeaderboard` | `pvpRanking` 컬렉션 상위 50 |

### 2) VX Shop 상품 등록
Verse8 VX Shop 에 아래 **productId** 로 상품을 등록해야 한다 (가격은 등록값이 표시에 우선).

| productId | 내용 | 기본가(VX) |
| --- | --- | --- |
| `starter_pack` | 보석 500 + 소환권 20 + 신화 확정권 1 + 골드 부스터 3 (1회 한정) | 30 |
| `monthly_pass` | 즉시 보석 300 + 30일간 매일 100 | 90 |
| `ad_remove` | 전면광고 제거, 보상형 광고 즉시 보상, 3배속, 보석 300 | 300 |
| `season_premium` | 이번 시즌 PvP 패스 프리미엄 트랙 | 150 |
| `summon_ticket_30` / `mythic_ticket` / `gold_booster_5` | 일반 모드 부스터 | 30 / 60 / 25 |
| `crystal_100` / `550` / `1200` / `2600` | 보석 | 10 / 50 / 100 / 200 |

### 3) 광고 플레이스먼트 (`ads.ts` `AD_PLACEMENTS`)
`reward_double`(결과 보상 2배), `reward_revive`(실패 시 1회 부활), `reward_ticket`(하루 3회 소환권 5장),
`interstitial_result`(1-4 이후, 2판마다 1회. 광고 제거 구매자 제외). Verse8 대시보드의 placementId 와 맞춘다.

## 밸런스

`tools/simulate.ts` 자동 플레이어로 검증한 곡선 (합성·스킬 반영, 웨이브 HP +11.5%):

**무한 모드 (평균 도달 웨이브):** 연구 0 → 26.5 / 1/4 → 35.6 / 절반 → 44.8 / 3/4 → 46.7 / 풀 → 50 (100% 클리어)

**캠페인 (클리어율):** 챕터1 은 연구 없이 대부분 클리어(접근성), 챕터2 후반은 연구 1/4~절반,
챕터3 후반은 연구 절반~3/4 + 유닛 Lv7 수준이 필요 → 성장(연구·유닛 레벨) 동기 부여.

## 참고

- 스프라이트는 96×128(32×32 3열×4행) RPG Maker 형식. 해금 유닛 5종은 기본 3종 시트를
  색조 회전해 임시로 만든다 (`assets.ts`). 전용 아트가 생기면 `config.ts` `UNITS[].hue` 를 0 으로 두고 시트를 추가.
- PvP 는 각 클라이언트가 자기 필드를 시뮬레이션하고 서버는 매칭·중계·판정만 담당한다.
  같은 `seed` 로 웨이브 구성(종족·몹 종류)이 양쪽 동일. 배속 1x 고정, 연구 미적용, 유닛 레벨 적용.
- 백그라운드 탭: 일반 모드는 멈추고, PvP 는 타이머 보조로 계속 진행된다.
