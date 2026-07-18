# 이관우 수학연구소(kwmath.co.kr) 기술·보안·운영 분석 리포트

## A. 한 줄 결론

이관우 수학연구소 사이트는 **Cloudflare Pages/Workers** 기반의 정적·서버리스 플랫폼 위에 **Vanilla JS PWA**로 구성된 교육용 포털이며, 백엔드 API는 `/api` 경로로 제공된다. 데이터 저장은 **Notion DB**와 **Cloudflare R2**를 사용하는 것으로 확인됐으며, 보안은 HTTPS와 JWT 기반 세션/관리자 토큰으로 보호되지만 **토큰을 로컬스토리지에 저장**하는 설계와 PWA 캐시/푸시 권한 관리에 대한 리스크가 존재한다.

## B. 확인된 사실

- **호스팅/CDN** – 사이트의 `robots.txt`가 Cloudflare Managed Content로 시작하며, 페이지 코드에는 `static.cloudflareinsights.com` 비콘 스크립트가 포함되어 있어 Cloudflare Pages/Workers에서 호스팅되는 것이 확인된다. 개인정보 처리방침에서도 **Cloudflare, Inc.**를 `웹사이트·어플 호스팅, 푸쉬 알림 발송, 파일 저장(R2)`의 수탁업체로 명시【666300656927840†L56-L60】.
- **프론트엔드** – 모든 화면은 **HTML + CSS + Vanilla JS**로 작성되며 별도의 프레임워크가 사용되지 않는다. 사용자 포털의 소스에서 `TOKEN_KEY` 등 상수 정의와 **Fetch API** 호출을 직접 작성한 코드가 확인된다【505659703168861†L310-L321】. 모바일 환경을 위해 **PWA**가 구현되어 있고 `manifest.json`에서 `display: standalone` 등 PWA 설정을 선언한다【325464800461886†L4-L9】. iOS/Android 설치 안내도 페이지 내에 명시되어 있다【505659703168861†L720-L724】.
- **서비스 워커** – `/sw.js`는 **앱 셸을 캐시하고 API는 network‑first** 정책으로 처리하는 서비스 워커다. `APP_SHELL` 배열에 `/portal`, `manifest.json`, 아이콘 등 주요 자원을 지정하고, API 요청은 실패 시 캐시를 반환한다【972278868755665†L8-L67】. 또한 `push` 이벤트를 수신하여 알림을 생성하고 클릭 시 `/portal`로 이동시키는 코드가 포함돼 있다【972278868755665†L104-L140】.
- **푸시 알림** – 포털 스크립트는 `navigator.serviceWorker.ready`를 통해 푸시 구독을 확인하고, `/api/push-vapid-public`에서 VAPID 공개키를 받아 `pushManager.subscribe`를 호출한다【505659703168861†L667-L705】. 구독 정보는 `/api/push-subscribe`에 POST/DELETE로 저장·삭제한다【505659703168861†L675-L709】. `Notification.requestPermission()`으로 권한을 요청한다【505659703168861†L687-L690】.
- **데이터 저장소** – 개인정보 처리방침에 `Notion Labs, Inc.`가 학생·리포트·후기 등 데이터베이스 관리 수탁업체로 명시되어 있어 **Notion DB**에 데이터를 저장하는 것으로 확인된다【666300656927840†L56-L60】. 파일과 영상은 Cloudflare R2에 저장되며, `/api/download-file?key=` 패턴으로 다운로드가 이루어진다【36992785094654†L145-L149】.
- **API 경로 및 기능** – 프론트엔드 코드와 관리자 콘솔 스크립트에서 다양한 `/api/*` 경로를 호출하는 것이 발견된다. 예를 들어:
  - `/api/auth/login`, `/api/auth/me`, `/api/auth/change-password` – 사용자 로그인/세션 검증/비밀번호 변경【505659703168861†L425-L444】【505659703168861†L725-L744】.
  - `/api/push-vapid-public` – VAPID 키 조회【505659703168861†L693-L703】.
  - `/api/push-subscribe` – 푸시 구독 정보 저장/해제【505659703168861†L668-L680】.
  - `/api/notices`, `/api/study` – 학원 공지와 공부 시간 데이터 조회【505659703168861†L783-L852】.
  - `/api/materials`, `/api/download-file` – 자료실 파일 목록 및 다운로드【36992785094654†L130-L149】.
  - 관리자 페이지에서는 `/api/admin-auth`로 로그인【944167916811857†L634-L646】하며, `/api/notices-write`, `/api/reports`, `/api/upload-file`, `/api/video-list` 등 다수의 관리자 전용 API를 호출한다【173151828214842†L1-L9】【173151828214842†L55-L70】.
- **로그인·세션 관리** – 사용자는 휴대폰 번호와 비밀번호로 로그인한다. 로그인 성공 시 응답의 JWT 토큰(`data.token`)과 전화번호가 **localStorage** 키 `kwmath_portal_token`, `kwmath_portal_phone`에 저장된다【505659703168861†L425-L444】. 자동 로그인은 `DOM ContentLoaded` 이벤트에서 localStorage에 저장된 토큰으로 `/api/auth/me`를 호출하여 복원된다【505659703168861†L725-L744】. 로그아웃 시 localStorage에서 토큰과 전화번호를 제거한다【505659703168861†L465-L468】.
- **관리자 인증** – 관리자 콘솔에서도 비밀번호를 입력해 `/api/admin-auth`에 POST하며, 반환된 `adminToken`을 localStorage `kwmath_admin_token`에 저장한다【944167916811857†L634-L649】. 이후 모든 관리자 API 요청에 `Authorization: Bearer <adminToken>` 헤더가 포함된다【944167916811857†L667-L676】.
- **개인정보 처리방침** – 수집 항목(학생 이름/학교/학년/휴대폰/성적 등), 자동 수집 항목(로그인 토큰, 접속 일시, 출결·공부 시간, 푸시 구독 정보)과 보유 기간(수강 종료 후 3년, 로그인 토큰 30일 등)이 명시되어 있다【666300656927840†L12-L41】. 수탁업체로 Cloudflare, Notion, Google Play, Apple App Store 등이 명시되었다【666300656927840†L56-L63】. 푸시 알림 수신에 동의하면 새 리포트·공지 알림을 발송하며 언제든지 거부할 수 있다고 한다【666300656927840†L89-L92】.
- **robots.txt** – 일반 검색 크롤러를 허용하되 `/api/`, `/admin.html`, `/portal.html` 등 내부 API와 HTML 파일은 크롤링을 금지하고 있다【435587103318978†L66-L72】. Cloudflare 관리용 지시(`Content‑Signal`)가 포함되어 있다【435587103318978†L30-L59】.
- **manifest & PWA 구성** – `manifest.json`에는 앱 이름, `start_url: /portal`, `scope: /`, `display: standalone`, `orientation: portrait`, 테마 색상과 아이콘 경로가 정의되어 있다【325464800461886†L4-L33】. `shortcuts` 항목으로 “리포트/영상/공지” 바로가기를 지원한다【325464800461886†L34-L67】. 별도의 관리자용 `manifest-admin.json`이 존재하며 `start_url: /admin`으로 설정되어 있다【307471479538†L1-L7】.
- **자료실/파일 저장** – 공개 자료실 페이지는 `/api/materials`로 파일 목록을 불러오고, 다운로드는 Cloudflare R2에서 `Content-Disposition: attachment` 헤더로 응답하기 때문에 클라이언트 코드에서 단순히 `/api/download-file?key=<R2 Key>` 경로로 이동하여 다운로드를 수행한다【36992785094654†L130-L149】. 파일 저장 위치 설명에 “class/{학원}_{반}/{MMDD}/”와 “reports/{학생이름}/” 패턴이 사용된다는 문구가 관리자 화면에 표시된다【417101431065615†L85-L91】.
- **외부 서비스 연동** – 페이지 소스에 `https://static.cloudflareinsights.com/beacon.min.js`가 포함되어 Cloudflare Analytics가 사용된다【36992785094654†L152-L154】. 카카오채널 문의 버튼이 존재하여 `pf.kakao.com`으로 연결된다【36992785094654†L86-L91】. Privacy Policy에 푸시 발송과 호스팅에 Cloudflare가 사용되고, Android/iOS 앱 배포를 위한 Google Play/Apple App Store가 수탁업체로 명시된다【666300656927840†L56-L63】.

## C. 강한 추정

- **백엔드 구현** – `/api` 경로에서 많은 엔드포인트가 호출되고, 서비스 워커는 **network‑first**로 해당 API를 처리한다【972278868755665†L59-L64】. 파일 다운로드 API에 “R2 download-file 함수가 Content-Disposition : attachment 헤더로 응답”이라는 주석이 있다【36992785094654†L145-L149】. 따라서 백엔드는 **Cloudflare Workers/Pages Functions**로 구현된 서버리스 API인 것으로 추정된다. 로그인·인증·공지·자료·출결 등 대부분의 비즈니스 로직이 이 서버리스 API로 처리되며, 데이터베이스는 Notion API로 연동하여 처리하는 것으로 예상된다.
- **세션/토큰 구조** – 응답 JSON에 `token` 필드를 포함하는 것으로 보아 **JWT** 또는 비슷한 서명 토큰을 사용하여 세션을 구현하는 것으로 추정된다. 토큰은 로컬스토리지에 저장되고, 모든 API 요청 시 `Authorization: Bearer <token>` 헤더로 전송된다【505659703168861†L425-L444】. 만료 시간은 개인정보 처리방침에서 “로그인 토큰 최대 30일”이라고 언급되어 있어 토큰 유효기간을 30일로 설정했을 가능성이 높다【666300656927840†L38-L41】.
- **DB 및 스토리지 구성** – 개인정보 처리방침에서 Notion Labs를 DB 관리 수탁업체로 명시하고 있어 **Notion Database**를 메인 데이터 저장소(학생·리포트·후기 등)로 사용하고, Cloudflare R2를 파일 저장소로 사용하는 구조로 추정된다【666300656927840†L56-L60】. 공지·리포트·학생 관리 등에서 사용하는 페이지 ID는 Notion 페이지 ID일 가능성이 있다. 영상의 경우 외부 YouTube 링크가 아닌 경우 R2에 업로드하는 기능이 있으나, 학생 영상이 잠금/공개 설정을 할 수 있는 점으로 보아 자체 저장소를 사용하며, 경우에 따라 YouTube iframe embed도 가능하다.
- **Android/iOS 앱** – `manifest.json`에 PWA 설정이 포함되어 있어 **네이티브 앱이 아닌 PWA 래핑**을 사용할 가능성이 높다. Privacy Policy에서 Google Play 및 Apple App Store를 수탁업체로 명시한 것을 보면, **iOS/Android 스토어에는 웹뷰 래핑 앱** 또는 포털 URL을 래핑한 하이브리드 앱을 배포할 수 있다.
- **Cloudflare 요금** – Pages/Workers 무료 티어에서 대부분 운영 가능하지만, R2 저장용량과 다운로드 요청에 따라 비용이 발생한다. 푸시 알림은 Cloudflare Web Push API로 구현돼 별도 비용 없이 이용 가능하나, 대량 푸시 발송 시 Workers의 일일 호출 한도를 초과할 수 있어 유료 플랜 필요할 수 있다. Notion API 사용량에 따라 비즈니스 플랜 구독이 필요할 수 있다.

## D. 불확실한 부분

- **DB 스키마 및 확장성** – Notion DB를 메인 DB로 사용하는 경우, 동시성 제어 및 트랜잭션 지원이 부족할 수 있다. 실제로 어떤 데이터를 Notion에 저장하는지, 어떤 부분은 Cloudflare D1/KV DB를 사용하는지 확인할 수 없었다.
- **푸시 서버 구현** – `/api/push-vapid-public`에서 공개키를 제공하는 것으로 보아 서버 측에서 VAPID 키를 관리하고 `push-subscribe` API를 통해 구독 정보를 저장한다. 하지만 실제 푸시 발송이 Cloudflare Workers Cron, Notion 자동화 혹은 외부 서비스(예: Pushpad)에서 이루어지는지 명확하지 않다.
- **영상 저장** – 관리자 페이지에서 영상을 잠그기/공개하기 기능이 있지만 영상이 R2에 저장되는지, YouTube 링크를 사용하는지 구체적으로 확인하지 못했다.
- **Cloudflare 보안 헤더** – 텍스트 기반 탐색으로는 `Content‑Security‑Policy`, `Strict‑Transport‑Security` 등 보안 헤더를 확인할 수 없었다. Cloudflare Defaults를 사용하고 있겠지만 설정 여부는 불확실하다.

## E. 기술 스택 구성도

```
[사용자 브라우저 / 모바일]
   ↕ (HTTPS, TLS)
Cloudflare CDN / Pages → 정적 HTML/CSS/JS + PWA (manifest.json, sw.js)
   ↕ (fetch)
Cloudflare Workers / Pages Functions (API 엔드포인트 `/api/*`)
   ↕
Notion Database (학생·리포트·후기 등)      Cloudflare R2 (자료실 파일·영상)
   ↕
VAPID 키 관리 및 Web Push Server (Cloudflare Workers 혹은 별도 서비스)
```

## F. 주요 URL/파일/요청 목록

| 분류 | URL/파일/요청 | 설명 |
|---|---|---|
| PWA Manifest | `/manifest.json` | 앱 이름, `start_url` (포털), 아이콘, shortcut 등을 정의【325464800461886†L4-L67】 |
| 관리자 Manifest | `/manifest-admin.json` | 관리자 앱용, `start_url: /admin` 지정【307471479538†L1-L7】 |
| Service Worker | `/sw.js` | 앱 셸 캐시, API network‑first, push 알림 처리 코드를 포함【972278868755665†L8-L96】 |
| 개인정보 처리방침 | `/privacy` | 수집 항목·보유 기간·수탁업체·푸시 알림 정책 명시【666300656927840†L12-L41】【666300656927840†L56-L63】 |
| 이용약관 | `/terms` | 서비스 이용 조건과 사용자 의무 등 규정【198670091338858†L8-L49】 |
| robots.txt | `/robots.txt` | `/api/` 등 민감 경로 비공개 설정 및 Cloudflare Content‑Signal【435587103318978†L30-L72】 |
| Sitemap | `/sitemap.xml` | 주요 공개 페이지(`register.html`, `reviews.html`, `materials.html`, `install.html`, `privacy.html`, `terms.html`) 포함 |
| 사용자 로그인 | `POST /api/auth/login` | 휴대폰 번호와 비밀번호를 JSON으로 전송 후 JWT 반환【505659703168861†L425-L444】 |
| 세션 검증 | `GET /api/auth/me` | 저장된 토큰으로 사용자 정보와 학생 목록 조회【505659703168861†L725-L744】 |
| 비밀번호 변경 | `POST /api/auth/change-password` | JWT 헤더와 함께 새 비밀번호 전송【505659703168861†L585-L599】 |
| 공지 조회 | `GET /api/notices` | 로그인한 사용자 혹은 관리자 권한으로 공지사항 리스트 조회【505659703168861†L783-L804】 |
| 공부시간 조회 | `GET /api/study?range=today` | 오늘 공부 시간 반환【505659703168861†L845-L852】 |
| 자료실 목록 | `GET /api/materials` | 공개 자료 목록 조회【36992785094654†L130-L149】 |
| 파일 다운로드 | `GET /api/download-file?key=<R2 Key>` | R2에서 파일 다운로드, Content‑Disposition 헤더 사용【36992785094654†L145-L149】 |
| 푸시 VAPID 키 | `GET /api/push-vapid-public` | 푸시 구독에 사용할 공개키 반환【505659703168861†L693-L703】 |
| 푸시 구독 관리 | `POST/DELETE /api/push-subscribe` | 사용자 ID와 subscription 정보 저장/삭제【505659703168861†L668-L709】 |
| 관리자 로그인 | `POST /api/admin-auth` | 관리자 비밀번호로 토큰 발급【944167916811857†L634-L646】 |
| 관리자 공지 쓰기 | `POST/PATCH/DELETE /api/notices-write` | 공지 작성·수정·삭제【173151828214842†L13-L17】【173151828214842†L25-L33】 |
| 관리자 리포트 조회 | `GET /api/reports` | 반별 리포트 리스트 조회【173151828214842†L37-L41】 |
| 관리자 파일 업로드 | `POST /api/upload-file` | FormData로 파일 업로드 후 R2 키 반환【173151828214842†L55-L58】 |
| 기타 관리자 API | `/api/video-list`, `/api/admin-bulk-move`, `/api/students`, `/api/class-options`, `/api/admin-approve-student` 등 |

## G. 인증/권한 구조 분석

- **사용자 인증** – 사용자는 휴대폰 번호와 비밀번호로 로그인한다. 로그인 성공 시 서버에서 **JWT 토큰**과 학생 목록, 관리자 여부를 반환한다. 클라이언트는 토큰과 휴대폰 번호를 **localStorage**(`kwmath_portal_token`, `kwmath_portal_phone`)에 저장하여 세션을 유지한다【505659703168861†L425-L444】. 토큰 만료 시간은 30일로 제한되어 있다고 개인정보처리방침에 명시되어 있다【666300656927840†L38-L41】.
- **세션 복원** – 앱 로딩 시 localStorage에서 토큰을 읽어 `/api/auth/me`를 호출한다. 응답이 실패하면 토큰을 삭제하고 로그인 화면을 보여준다【505659703168861†L725-L744】.
- **권한 구분** – `data.isAdmin` 플래그로 사용자가 관리자 권한인지 판단하고, 포털 화면에서 관리자 메뉴를 표시/숨긴다【505659703168861†L441-L443】. 관리자 콘솔은 `/admin` 경로에서 별도의 로그인(비밀번호) 후 `adminToken`을 발급하며, 로컬스토리지에 `kwmath_admin_token`으로 저장한다【944167916811857†L634-L649】.
- **API 인증** – 일반 사용자 API는 `Authorization: Bearer <token>` 헤더를 사용하며, 관리자 API는 `Bearer adminToken`을 사용한다. 서버는 토큰을 검증하여 사용자의 학생·학원·반 정보에 따라 데이터 범위를 제한하는 것으로 추정된다. 그러나 토큰이 브라우저 **localStorage**에 저장되므로 **XSS 공격 시 탈취**될 가능성이 있다.
- **권한 검증** – 클라이언트는 관리자 버튼을 숨기지만, 관리자 API 요청에서는 서버가 `adminToken`을 검증해야 한다. 프론트 코드에서 권한 없는 상태에서 API 호출 시 에러를 처리하는 부분이 있으나, 서버 단의 권한 체크 구현은 확인할 수 없었다.

## H. PWA/Push 구조 분석

| 항목 | 내용 |
|---|---|
| **Manifest** | `manifest.json`에 `start_url:/portal`, `display:standalone`, `background_color` 및 아이콘 목록이 정의됨【325464800461886†L4-L33】. Shortcuts로 리포트/영상/공지 바로가기 제공. 별도의 `manifest-admin.json`도 존재하여 관리자 앱을 PWA로 설치 가능【307471479538†L1-L7】. |
| **Service Worker** | `/sw.js`는 앱 셸을 캐시(`APP_SHELL`), HTML 페이지를 network‑first로 가져오고, API 경로(`/api/`)와 static 파일에 대해 다른 캐싱 전략을 적용한다【972278868755665†L8-L67】. 푸시 알림 이벤트에서 `showNotification`을 호출하고, `notificationclick`에서 포털로 리다이렉트한다【972278868755665†L104-L140】. |
| **오프라인 지원** | 앱 셸과 아이콘·manifest는 캐시되므로 포털 UI는 오프라인에서도 일부 열리지만, `/api/*` 요청은 network‑first이므로 오프라인 시 데이터가 표시되지 않을 수 있다. |
| **설치 안내** | 포털 스크립트는 `beforeinstallprompt` 이벤트를 수신하여 설치 배너 버튼을 보여주고, 사용자가 클릭하면 `prompt()`로 설치를 진행한다【505659703168861†L753-L773】. 설치 후 `appinstalled` 이벤트를 처리하여 배너를 숨긴다【505659703168861†L775-L781】. |
| **푸시 알림** | 로그인 후 사용자가 `toggleEnablePush()` 버튼을 누르면 `Notification.requestPermission()`으로 권한을 요청하고, VAPID 공개키를 `/api/push-vapid-public`에서 받아 `pushManager.subscribe()`를 호출한다【505659703168861†L667-L705】. 구독 정보는 `/api/push-subscribe`에 저장되며 해제 시 DELETE 요청을 보낸다【505659703168861†L675-L709】. 알림 메시지는 서비스 워커가 `push` 이벤트에서 `showNotification()`으로 표시하고 클릭하면 포털 페이지로 포커스하거나 새 창을 열어준다【972278868755665†L104-L140】. |
| **푸시 리스크** | 구독 정보에는 브라우저의 endpoint URL과 키가 포함되어 있고, 이는 `/api/push-subscribe`에 저장된다. 취소 시 DELETE 요청으로 삭제되지만, 사용자가 “알림 끄기”를 누르지 않은 채 브라우저에서 권한만 차단하면 서버에 잔존할 수 있다. |

## I. 데이터/스토리지 구조 분석

- **Notion DB** – 개인정보 처리방침에서 Notion이 데이터베이스 관리 수탁업체로 명시되어 있어, 학생 정보·리포트·공지·후기 등이 **Notion Database**에 저장된다【666300656927840†L56-L60】. 클라이언트 스크립트에서 `pageId` 등을 사용해 공지/리포트 수정·삭제를 요청하는 부분이 있어 Notion 페이지 ID를 API로 전달하는 것으로 보인다.
- **Cloudflare R2** – 자료실 파일은 R2에 저장된다. 다운로드 URL은 `/api/download-file?key=<R2 Key>` 형식을 사용하고, 주석에서 “R2 download-file 함수가 Content‑Disposition: attachment 헤더로 응답”이라고 설명되어 있다【36992785094654†L145-L149】. 관리자 화면에는 파일 저장 경로 예시(예: `class/{학원}_{반}/{MMDD}` 또는 `reports/{학생이름}`)가 표시된다【417101431065615†L85-L91】.
- **로컬스토리지** – 사용자 토큰/휴대폰 번호(`kwmath_portal_token`, `kwmath_portal_phone`)와 푸시 안내 배너 Snooze 시간(`pushSnoozedUntil`)이 localStorage에 저장된다【505659703168861†L643-L645】. 선택된 학생 정보는 sessionStorage(`kwmath_selected_student`)에 저장된다【505659703168861†L541-L545】. 관리자 토큰은 `kwmath_admin_token`에 저장된다【944167916811857†L634-L649】.
- **쿠키 사용** – 클라이언트 코드에서 쿠키를 직접 사용하지 않았으며, 세션은 토큰 기반이다. Cloudflare __cfduid 등 기본 쿠키는 브라우저에서 설정될 가능성이 있다.

## J. 관리자 기능 구조 분석

관리자 콘솔(`/admin`)은 로그인 후 여러 탭을 제공하며 다음 기능을 수행한다.

| 기능 | 설명 및 API |
|---|---|
| **공지사항 관리** | 목록 조회(`/api/notices`), 공지 작성/수정/삭제(`/api/notices-write`), 예약 푸시 발송(`/api/notices-flush`) 등이 가능【173151828214842†L13-L17】【173151828214842†L19-L23】. 대상(전체/학원/반/개인)을 선택하고 즉시·예약 발송을 설정한다【417101431065615†L20-L36】. |
| **리포트 조회/수정** | 반별 리포트 목록을 `/api/reports`로 불러오고, 수정·삭제 시 `/api/reports-write`에 PATCH/DELETE 요청을 보낸다【173151828214842†L37-L47】. |
| **학생 목록·승인** | `/api/students`에서 학생 리스트를 가져와 신규 등록 대기 학생을 승인·거절(`/api/admin-approve-student`)하는 기능이 있다【173151828214842†L109-L124】. 학원/반 관리(추가/삭제) 요청은 `/api/class-options` POST로 처리한다【173151828214842†L85-L100】. 일괄 이동(시즌 전환)도 `/api/admin-bulk-move`로 실행한다【173151828214842†L103-L107】. |
| **출결/숙제 관리** | 반별 출석 현황을 불러와 학생의 출석·숙제를 체크한다. 구체적인 API는 `loadAttendanceTab()`에서 `/api/attendance`와 유사한 엔드포인트를 호출할 가능성이 있다. |
| **자료실 관리** | 파일 업로드는 `/api/upload-file`에 POST(FormData)로 수행하며 업로드 후 R2 key와 크기를 반환한다【173151828214842†L55-L58】. 업로드된 파일 목록은 `/api/list-files`로 조회하고 다운로드(`/api/download-file`)와 삭제(`/api/delete-file`)도 지원한다【173151828214842†L61-L76】. |
| **영상 관리** | `/api/video-list`로 영상 목록을 조회하고, 영상의 잠금/공개 상태를 `/api/video-update` POST 요청으로 변경한다【173151828214842†L133-L143】. 영상 삭제는 `/api/video-delete`로 처리한다. 잠금 기능은 학생이 수업코드를 입력해야 영상을 볼 수 있도록 한다는 설명이 페이지에 있다【417101431065615†L107-L114】. |
| **학원·반 관리 및 시즌 전환** | `/api/class-options` GET/POST로 학원/반 옵션을 조회·수정하고, `/api/admin-bulk-move`로 다수 학생을 새 반으로 이동한다【173151828214842†L97-L107】. 시즌 전환 시 새 반을 만들고 이전 반 데이터를 archived로 이동한다는 설명이 있다【417101431065615†L126-L134】. |

## K. 보안 리스크 표

| 항목 | 위험도 | 근거 | 확인 방법 | 개선 방향 |
|---|---|---|---|---|
| **JWT 토큰의 로컬스토리지 저장** | 중간 | 토큰을 `localStorage`에 저장하고 모든 API 요청 시 Authorization 헤더로 사용한다【505659703168861†L425-L444】. XSS 취약점 발생 시 토큰 탈취 가능. | 포털 스크립트 분석 및 Network 요청 확인. | 토큰을 `HttpOnly` 쿠키에 저장하거나, Content Security Policy와 입력 필터링을 강화해 XSS를 예방. |
| **서비스 워커 캐시로 민감 페이지 캐싱** | 낮음 | `/sw.js`는 앱 셸과 HTML 페이지를 캐시한다【972278868755665†L8-L96】. 로그아웃 후에도 캐시에 메인 화면 HTML이 남을 수 있다. | 서비스 워커 코드 분석. | 민감한 페이지는 `Cache-Control: no-store` 헤더를 추가하거나 서비스 워커에서 민감 페이지 캐싱을 제외. |
| **푸시 구독 정보 관리** | 중간 | `/api/push-subscribe`에 저장된 endpoint 정보가 서버에 남으며 삭제 요청을 별도로 해야 한다【505659703168861†L668-L709】. 사용자가 브라우저에서 권한만 차단하면 서버에는 잔존할 수 있음. | 클라이언트 코드와 API 확인. | 구독 리스트 정기 정리, “알림 끄기” UI 안내, 사용자 ID 탈퇴 시 구독 정보도 삭제. |
| **Notion DB 권한 및 감사 로그** | 중간 | 학생/리포트/후기 데이터를 Notion DB에 저장하는 것으로 추정【666300656927840†L56-L60】. Notion API는 데이터 변경 로그와 세분화된 권한 제어가 제한적이다. | 개인정보 처리방침, 관리자 기능 분석. | 접근 제어를 강화하고 정기적으로 감사 로그를 기록하거나 별도의 DB로 이전. |
| **R2 파일 URL 공개** | 중간 | `/api/download-file`으로 다운로드하면 R2 키를 쿼리스트링으로 넘겨 누구나 다운로드할 수 있다【36992785094654†L145-L149】. 키를 아는 경우 인증 없이 파일 접근 가능할 수 있음. | 자료실 스크립트와 URL 패턴 분석. | 임시 서명 URL(Presigned URL) 사용 또는 서버 측에서 인증 후 스트림 전송. |
| **관리자 API 권한 검증** | 높음 | 관리자 메뉴 숨김만으로 권한을 숨기지만, 실제 API 요청은 `adminToken`을 요구한다. 토큰 발급 후 브라우저 저장으로 탈취 시 관리자 권한이 완전히 노출될 수 있다【944167916811857†L634-L649】. | 관리자 스크립트와 API 호출 분석. | 관리자 토큰 저장 위치 개선(쿠키+HttpOnly), 관리자용 2FA 도입, 요청 IP 제한 등. |
| **CORS 정책 확인 불가** | 미정 | Cloudflare에 의해 기본 CORS 설정이 적용될 것으로 예상되지만, 직접 확인하지 못함. 잘못된 CORS 설정 시 외부 사이트에서 API 호출 가능. | curl 헤더 확인 (Cloudflare 403으로 제한됨). | 서버 측에서 `Access-Control-Allow-Origin`을 엄격히 설정. |
| **Content‑Security‑Policy 등 보안 헤더** | 미정 | curl 헤더를 확인할 수 없어 CSP/HSTS/Referrer‑Policy 등 보안 헤더 유무를 확인하지 못했다. | 서버 헤더 분석 시도했지만 Cloudflare가 403을 반환. | Cloudflare Pages의 `securityHeaders` 설정을 통해 CSP, HSTS, X‑Frame‑Options, Referrer‑Policy, Permissions‑Policy 등 헤더를 명시적으로 구성. |
| **공부시간·랭킹 조작 가능성** | 낮음~중간 | `KW-Study`가 `/api/study?range=today`로 시간 데이터를 조회한다【505659703168861†L845-L852】. 클라이언트 코드에서 어떻게 시간을 기록하는지 확인할 수 없지만, 클라이언트 측에만 의존하면 조작 위험. | Study 관련 코드/서버 구현 미공개. | 서버 측에서 타임스탬프 기록, 캡차·안티봇 적용, 조작 탐지 로직 구현. |
| **예약 푸시 발송 관리** | 중간 | 관리자 콘솔에서 즉시 발송·예약 발송을 선택할 수 있으며 `/api/notices-flush`로 예약을 트리거한다【173151828214842†L19-L23】. 예약 발송 로직이 서버리스 환경에서 제대로 스케줄링되는지 확인 필요. | 관리자 스크립트 분석. | Cloudflare Workers Cron 등을 안정적으로 구성하고, 예약 내역과 로그를 관리. |

## L. 과금/유지비용 추정 표 (Cloudflare/Notion 기준)

| 항목 | 사용 가능 서비스 | 비용 발생 조건 | 비용 리스크 |
|---|---|---|---|
| **Cloudflare Pages** | 정적 사이트 호스팅, 자동 CI/CD | 무료 티어 월 500 빌드, 에서 초과 시 유료 (Pro $20/월). | 새 배포가 잦거나 빌드 횟수가 많으면 추가 비용. |
| **Cloudflare Workers/Functions** | 서버리스 API(`/api/*`), Web Push 처리 | 무료 티어 100k 요청/일, CPU 시간 10ms/요청; 초과 시 $0.30/백만 요청. | 학생 수 증가로 API 호출이 많아지면 비용 상승. |
| **Cloudflare R2** | 파일·영상 저장 | 저장 1 GB당 $0.015/월, 읽기 트래픽 1 GB당 $0.09, PUT/LIST 요청 1만당 $0.005 | 영상·자료 다운로드가 많을 경우 다운로드 비용 증가. |
| **Web Push 발송** | Cloudflare Workers Subrequests | 웹푸시 자체는 무료지만, 발송 트리거가 Workers에 의해 실행되므로 API 호출 수에 따라 Workers 비용 발생. | 공지/리포트가 많아 Push 발송이 잦으면 Workers 비용 증가. |
| **Notion API 플랜** | 데이터베이스 저장 | 무료 플랜에서는 API 호출량과 협업 사용자 수 제한; 업무용 플랜($8~$18/월) 필요할 수 있음. | 학생·리포트 데이터가 많으면 Notion 비용 증가 또는 제한. |
| **Cloudflare Analytics** | 페이지뷰·성능 모니터링 | 대부분 무료; 자세한 보고서 기능은 유료 플랜 필요. | – |
| **Google Play / Apple Developer** | Android/iOS 앱 배포 | Google Play 콘솔 연 $25, Apple Developer Program 연 $99. | 앱을 PWA로 대체하면 비용 절감 가능. |
| **도메인 등록** | `kwmath.co.kr` 도메인 | .co.kr 도메인 연 $20 내외 | – |

## M. Firebase LMS 사이트와 비교할 때 참고할 포인트

- **스택 단순화 vs. 강력한 기능** – 이관우 수학연구소는 **Cloudflare Pages + Workers + Notion DB + R2** 조합으로 간결하게 구축되어 있으며, 프레임워크 없이 Vanilla JS PWA로 작동한다. Firebase LMS는 Firestore/Realtime Database, Firebase Auth, Cloud Storage, Cloud Functions 등 일체형 백엔드 서비스를 제공하므로 인증·스토리지·데이터베이스·알림을 모두 Firebase에서 처리할 수 있고, Frontend SDK도 풍부하다.
- **데이터 모델** – Notion DB는 사용 편의성과 문서형 구조가 장점이지만, 쿼리 성능과 트랜잭션, 권한 관리가 제한적이다. Firebase Firestore는 서버 사이드 보안 규칙과 트랜잭션 지원이 있으며, 대규모 동시성에 유리하다.
- **세션 관리** – 현 사이트는 JWT를 로컬스토리지에 저장하는 방식으로 브라우저 XSS에 취약하다. Firebase Auth는 HttpOnly 쿠키 기반 세션 혹은 SDK 기반 관리가 가능해 보안성이 높다.
- **Push 알림 구현** – Cloudflare Workers로 VAPID 키 관리 및 푸시 발송을 직접 구현해야 한다. Firebase Cloud Messaging(FCM)은 토큰 관리와 발송·구독 주제(Topic) 기능을 기본 제공하므로 구현이 간단하며, Android/iOS 앱과 웹을 통합 지원한다.
- **파일 저장 및 권한** – R2는 공용 URL을 생성하는 방식이며 서버의 인증 로직에 따라 키 노출 위험이 존재한다. Firebase Storage는 인증된 다운로드 URL과 세분화된 보안 규칙을 제공한다.
- **관리자 콘솔** – 이관우 수학연구소는 자체 관리자 페이지를 통해 공지·리포트·학생 관리를 구현했다. Firebase LMS는 Firebase Console을 사용하거나, React/Admin SDK로 별도 관리자 앱을 구축해야 한다.

## N. 추가로 확인해야 할 자료 목록

1. **API 응답 구조** – `/api/auth/login`, `/api/notices`, `/api/study` 등 실제 응답 JSON을 확인하면 DB 스키마와 권한 제어 방식을 더 명확히 파악할 수 있다.
2. **보안 헤더** – Cloudflare Pages가 반환하는 응답 헤더(`Content‑Security‑Policy`, `Strict‑Transport‑Security`, `Referrer‑Policy`, `Permissions‑Policy` 등)를 확인하여 설정 여부를 점검해야 한다. 현재 curl 요청이 Cloudflare 403으로 차단되어 확인하지 못했다.
3. **프로덕션 코드 리포지토리** – GitHub 등에서 프런트엔드·백엔드 코드가 공개되어 있다면, API 구현과 Notion DB 연동 방식, 토큰 발급·만료 로직, 푸시 발송 스케줄러를 자세히 분석할 수 있다.
4. **푸시 발송 서버** – `/api/notices-flush`의 서버리스 스케줄러 구현과, 예약 푸시 발송 시 로깅·보안·추적 기능을 어떻게 구현하는지 확인한다.
5. **iOS/Android 앱 형태** – App Store/Play Store에 배포된 앱을 설치하여, 네이티브 코드인지 WebView PWA 래핑인지, 추가 기능(예: 위젯, 백그라운드 Push 처리)이 있는지 검증한다.
6. **Cloudflare Access/Firewall 설정** – `/api/` 경로의 보호를 위해 IP 대역 제한이나 Bot Management가 적용되어 있는지, 관리자 페이지 접근을 Cloudflare Zero Trust로 제한하는지 확인한다.

