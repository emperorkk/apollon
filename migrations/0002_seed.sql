-- World Intelligence Dashboard — Seed data: topics + initial 25 RSS sources
-- Spec §8 (sources) and Goals §2 (topic taxonomy)

INSERT INTO topics (name, name_gr, keywords, color_hex, trigger_level, active) VALUES
  ('Energy',            'Ενέργεια',     '["oil","gas","LNG","pipeline","OPEC","renewable","electricity","energy crisis"]', '#f2c14e', 3, 1),
  ('War & Conflict',    'Πόλεμος',      '["war","conflict","military","invasion","strike","ceasefire","insurgency"]',      '#e94560', 3, 1),
  ('Natural Disasters', 'Φυσικές Καταστροφές', '["earthquake","flood","hurricane","wildfire","tsunami","volcano","disaster"]', '#ff8c42', 3, 1),
  ('Diplomacy',         'Διπλωματία',   '["summit","treaty","sanctions","negotiation","embassy","UN","bilateral"]',        '#4ecdc4', 3, 1),
  ('Logistics',         'Εφοδιαστική',  '["shipping","supply chain","freight","port","trade route","maritime"]',           '#9b5de5', 3, 1),
  ('General',           'Γενικά',       '["politics","economy","government","policy"]',                                    '#8892a0', 3, 1);

INSERT INTO sources (id, name, rss_url, region, language, category_bias, active) VALUES
  ('reuters-world',       'Reuters World',            'https://feeds.reuters.com/reuters/worldNews',                              'INT', 'en', 'general',           1),
  ('ap-top-news',         'AP Top News',               'https://feeds.apnews.com/apnews/topnews',                                  'INT', 'en', 'general',           1),
  ('bbc-world',           'BBC World',                 'https://feeds.bbci.co.uk/news/world/rss.xml',                              'INT', 'en', 'general',           1),
  ('aljazeera-en',        'Al Jazeera EN',             'https://www.aljazeera.com/xml/rss/all.xml',                                'INT', 'en', 'general',           1),
  ('france24-en',         'France 24 EN',              'https://www.france24.com/en/rss',                                          'FR',  'en', 'general',           1),
  ('dw-world',            'DW World',                  'https://rss.dw.com/xml/rss-en-world',                                      'DE',  'en', 'general',           1),
  ('nhk-world',           'NHK World',                 'https://www3.nhk.or.jp/rss/news/cat0.xml',                                 'JP',  'en', 'general',           1),
  ('channel-newsasia',    'Channel NewsAsia',          'https://www.channelnewsasia.com/rss',                                      'SG',  'en', 'general',           1),
  ('ekathimerini',        'Ekathimerini',              'https://www.ekathimerini.com/rss',                                         'GR',  'en', 'general',           1),
  ('jerusalem-post',      'Jerusalem Post',            'https://www.jpost.com/rss/rssfeedsheadlines.aspx',                         'IL',  'en', 'general',           1),
  ('haaretz-en',          'Haaretz EN',                'https://www.haaretz.com/srv/rss',                                          'IL',  'en', 'diplomacy',         1),
  ('egypt-independent',   'Egypt Independent',         'https://www.egyptindependent.com/feed',                                    'EG',  'en', 'general',           1),
  ('notes-from-poland',   'Notes from Poland',         'https://notesfrompoland.com/feed',                                         'PL',  'en', 'general',           1),
  ('nikkei-asia',         'Nikkei Asia',               'https://asia.nikkei.com/rss/feed/nar',                                     'JP',  'en', 'energy/logistics',  1),
  ('scmp',                'South China Morning Post',  'https://www.scmp.com/rss/91/feed',                                         'CN',  'en', 'general',           1),
  ('cgtn-world',          'CGTN World',                'https://www.cgtn.com/subscribe/feeds/en/NewsUpdate.xml',                   'CN',  'en', 'general',           1),
  ('iea-news',            'IEA News',                  'https://www.iea.org/feed',                                                 'INT', 'en', 'energy',            1),
  ('oilprice',            'OilPrice.com',              'https://oilprice.com/rss/main',                                            'INT', 'en', 'energy',            1),
  ('reliefweb',           'ReliefWeb',                 'https://reliefweb.int/updates/rss.xml',                                    'INT', 'en', 'disasters',         1),
  ('gdacs-alerts',        'GDACS Alerts',              'https://www.gdacs.org/gdacsapi/api/rss',                                   'INT', 'en', 'disasters',         1),
  ('isw',                 'Institute for Study of War','https://www.understandingwar.org/rss.xml',                                 'INT', 'en', 'war',               1),
  ('bellingcat',          'Bellingcat',                'https://www.bellingcat.com/feed',                                          'INT', 'en', 'war',               1),
  ('freightwaves',        'FreightWaves',              'https://www.freightwaves.com/fw-content/uploads/rss.xml',                  'INT', 'en', 'logistics',         1),
  ('lloyds-list',         'Lloyd''s List',             'https://lloydslist.maritimeintelligence.informa.com/rss',                  'INT', 'en', 'logistics',         1),
  ('cfr',                 'CFR',                       'https://www.cfr.org/rss/region_rss/all',                                   'INT', 'en', 'diplomacy',         1);
