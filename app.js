const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 80;

// ✅ 1. 세션 설정
app.use(session({
  secret: 'secret_key',
  resave: false,
  saveUninitialized: true
}));

// ✅ 2. body-parser 설정
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ✅ 5. 모든 EJS 뷰에 user 객체 전달
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ✅ 3. 정적 파일 제공
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/img', express.static(path.join(__dirname, 'img')));

// ✅ 4. 뷰 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ✅ 데이터베이스 연결
const db = mysql.createConnection({
  host: '10.10.100.231',
  user: 'root',
  password: 'test123',
  database: 'webapp_db'
});

db.connect((err) => {
  if (err) {
    console.error('MySQL 연결 실패:', err.stack);
    return;
  }
  console.log('MySQL 원격 연결 성공');
});

// ✅ 인증 미들웨어
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// ✅ 로그인 페이지 (GET)
app.get('/login', (req, res) => {
  res.render('login', { message: null });
});

app.post('/login', (req, res) => {
  console.log('🔍 로그인 요청:', req.body);

  const { user_id, password } = req.body;

  if (!user_id || !password) {
    return res.render('login', { message: '⚠️ 아이디와 비밀번호를 입력해주세요.' });
  }

  db.query('SELECT * FROM users WHERE user_id = ?', [user_id], (err, rows) => {
    if (err) {
      console.error('❌ 데이터베이스 오류:', err);
      return res.render('login', { message: '⚠️ 서버 오류가 발생했습니다.' });
    }

    if (rows.length === 0) {
      console.log('⚠️ 사용자 없음:', user_id);
      return res.render('login', { message: '⚠️ 잘못된 아이디 또는 비밀번호입니다.' });
    }

    const user = rows[0];
    console.log('✅ 사용자 확인:', user);

    bcrypt.compare(password, user.password, (err, result) => {
      if (err || !result) {
        return res.render('login', { message: '⚠️ 잘못된 아이디 또는 비밀번호입니다.' });
      }

      req.session.user = {
        id: user.id,
        user_id: user.user_id,
        app: user.app,
        ver: user.ver,
        pub_ip: user.pub_ip,
        replicas: user.replicas || 1
      };

      res.redirect('/board');
    });
  });
});

// ✅ 회원가입 페이지
app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', (req, res) => {
  const { user_id, password } = req.body;
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      return res.status(500).send('회원가입 실패: 비밀번호 해싱 오류');
    }
    db.query('INSERT INTO users (user_id, password, app, ver, pub_ip) VALUES (?, ?, ?, ?, ?)', [user_id, hash, '', '', ''], (err) => {
      if (err) {
        return res.status(500).send('회원가입 실패');
      }
      res.redirect('/login');
    });
  });
});

// ✅ 서비스 신청 페이지
app.get('/board', isAuthenticated, (req, res) => {
  res.render('board', {
    user: req.session.user,
    message: req.session.message || null
  });
  req.session.message = null;
});

// ✅ 서비스 신청 페이지 (POST)
app.post('/board', isAuthenticated, async (req, res) => {
  let { app, ver, resource } = req.body;

  console.log('📊 선택된 리소스 옵션:', resource);

  // 리소스 옵션 검증
  const resourceOptions = {
    'ram512-cpu0.5': { ram: 512, cpu: 0.5 },
    'ram1024-cpu1': { ram: 1024, cpu: 1.0 },
    'ram2048-cpu2': { ram: 2048, cpu: 2.0 },
  };

  if (!resource || !resourceOptions[resource]) {
    return res.status(400).render('board', {
      user: req.session.user,
      message: '⚠️ 올바른 RAM & CPU 옵션을 선택해주세요.'
    });
  }

  const { ram, cpu } = resourceOptions[resource];

  console.log(`🖥️ 선택된 리소스 - RAM: ${ram}MB, CPU: ${cpu} Core`);

  // 데이터베이스 업데이트
  db.query(
    'UPDATE users SET app = ?, ver = ?, ram = ?, cpu = ? WHERE id = ?',
    [app, ver, ram, cpu, req.session.user.id],
    async (err) => {
      if (err) {
        console.error('❌ 서비스 신청 오류:', err.message);
        return res.status(500).render('board', {
          user: req.session.user,
          message: '❌ 서비스 신청 중 오류가 발생했습니다.'
        });
      }

      console.log('✅ 서비스 신청 성공 - RAM:', ram, 'CPU:', cpu);

      // 🔗 Webhook 호출
      try {
        const response = await axios.post(process.env.WEBHOOK_URL, {
          token: process.env.WEBHOOK_SECRET
        });
        console.log('✅ Webhook 호출 성공:', response.data);
      } catch (error) {
        console.error('❌ Webhook 호출 실패:', error.message);
      }

      // 🚀 리디렉션
      if (!res.headersSent) {
        return res.redirect('/loading');
      }

      console.warn('⚠️ 응답이 이미 전송되어 리디렉션할 수 없습니다.');
    }
  );
});


// ✅ 로딩 페이지
app.get('/loading', isAuthenticated, (req, res) => {
  res.render('loading');
  setTimeout(() => {
    if (!res.headersSent) {
      res.redirect('/complete');
    }
  }, 6000);
});

// 완료 페이지
app.get('/complete', isAuthenticated, (req, res) => {
  const user_id = req.session.user.user_id;

  // ✅ pub_ip 조회 (절대 수정하지 않음)
  db.query('SELECT pub_ip FROM users WHERE user_id = ?', [user_id], (err, results) => {
    if (err) {
      console.error('❌ pub_ip 조회 오류:', err.message);
      return res.status(500).send('pub_ip 조회 실패!');
    }

    const pub_ip = results.length > 0 && results[0].pub_ip ? results[0].pub_ip : 'IP가 할당되지 않았습니다.';
    console.log('✅ pub_ip 조회 성공:', pub_ip);

    // ✅ app, db_dns 한 번의 쿼리로 조회
    db.query('SELECT app, db_dns FROM users WHERE user_id = ?', [user_id], (err, additionalResults) => {
      if (err) {
        console.error('❌ app, db_dns 조회 오류:', err.message);
        return res.status(500).send('app, db_dns 조회 실패!');
      }

      const app = additionalResults.length > 0 && additionalResults[0].app ? additionalResults[0].app : 'N/A';
      const db_dns = additionalResults.length > 0 && additionalResults[0].db_dns ? additionalResults[0].db_dns : 'N/A';

      console.log('✅ 추가 정보 조회 성공:', { app, db_dns });

      // ✅ EJS로 렌더링
      res.render('complete', {
        user: req.session.user,
        pub_ip,
        app,
        db_dns
      });
    });
  });
});

// ✅ 로그아웃 라우터
app.get('/logout', (req, res) => {
  // 세션 삭제
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ 세션 삭제 오류:', err);
      return res.status(500).send('서버 오류로 로그아웃에 실패했습니다.');
    }
    // 세션 쿠키 삭제
    res.clearCookie('connect.sid'); // 세션 쿠키 이름 (기본값: connect.sid)
    console.log('✅ 로그아웃 성공: 세션이 삭제되었습니다.');
    res.redirect('/login'); // 로그인 페이지로 리디렉션
  });
});

app.listen(port, () => {
  console.log(`http://localhost:${port}에서 서버가 실행 중입니다`);
});
