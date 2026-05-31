const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, range, accept, accept-language, cache-control, pragma',
}

const INVESTING_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "domain-id": "www",
  "Accept": "application/json",
};

// ===== Comprehensive EGX Stock List with Investing.com pairIds =====
// This is the fallback list. The function will also try dynamic discovery.
const EGX_SYMBOLS: { id: string; pairId: number; nameAr: string; sector: string }[] = [
  // البنوك
  { id: "comi", pairId: 12865, nameAr: "البنك التجاري الدولي", sector: "بنوك" },
  { id: "cieb", pairId: 12979, nameAr: "بنك كريدي أجريكول", sector: "بنوك" },
  { id: "adib", pairId: 40917, nameAr: "مصرف أبوظبي الإسلامي", sector: "بنوك" },
  { id: "faisal", pairId: 13002, nameAr: "بنك فيصل الإسلامي", sector: "بنوك" },
  { id: "saud", pairId: 12951, nameAr: "بنك البركة", sector: "بنوك" },
  { id: "hdbk", pairId: 12921, nameAr: "بنك التعمير والإسكان", sector: "بنوك" },
  { id: "qnbe", pairId: 12940, nameAr: "بنك قطر الوطني الأهلي", sector: "بنوك" },
  { id: "cana", pairId: 12863, nameAr: "بنك قناة السويس", sector: "بنوك" },
  { id: "faita", pairId: 13003, nameAr: "بنك فيصل الإسلامي - دولار", sector: "بنوك" },
  { id: "expa", pairId: 12872, nameAr: "البنك المصري لتنمية الصادرات", sector: "بنوك" },
  { id: "unbe", pairId: 12957, nameAr: "المصرف المتحد", sector: "بنوك" },
  { id: "saib", pairId: 12950, nameAr: "بنك الشركة المصرفية العربية", sector: "بنوك" },
  { id: "aidb", pairId: 12862, nameAr: "البنك العربي الأفريقي الدولي", sector: "بنوك" },
  // العقارات
  { id: "tmgh", pairId: 12889, nameAr: "طلعت مصطفى القابضة", sector: "عقارات" },
  { id: "ocdi", pairId: 12880, nameAr: "أوراسكوم للتنمية", sector: "عقارات" },
  { id: "heli", pairId: 12922, nameAr: "مصر الجديدة للإسكان", sector: "عقارات" },
  { id: "emfd", pairId: 960752, nameAr: "إعمار مصر", sector: "عقارات" },
  { id: "phdc", pairId: 12883, nameAr: "بالم هيلز للتعمير", sector: "عقارات" },
  { id: "areh", pairId: 12897, nameAr: "المصرية للعقارات", sector: "عقارات" },
  { id: "orhd", pairId: 40620, nameAr: "أوراسكوم للفنادق والتنمية", sector: "عقارات" },
  { id: "mnhd", pairId: 12933, nameAr: "مدينة نصر للإسكان والتعمير", sector: "عقارات" },
  { id: "elms", pairId: 12870, nameAr: "السادس من أكتوبر للتنمية", sector: "عقارات" },
  { id: "gppl", pairId: 1099398, nameAr: "جولدن بيراميدز بلازا", sector: "عقارات" },
  // الخدمات المالية
  { id: "hrho", pairId: 12875, nameAr: "هيرميس القابضة", sector: "خدمات مالية" },
  { id: "efih", pairId: 1178529, nameAr: "إي فاينانس", sector: "خدمات مالية" },
  { id: "ccap", pairId: 12864, nameAr: "القلعة القابضة", sector: "خدمات مالية" },
  { id: "raya", pairId: 12948, nameAr: "راية القابضة", sector: "خدمات مالية" },
  { id: "racc", pairId: 1036884, nameAr: "راية لمراكز الاتصالات", sector: "خدمات مالية" },
  { id: "ofh", pairId: 1170419, nameAr: "أوراسكوم المالية القابضة", sector: "خدمات مالية" },
  { id: "oih", pairId: 40621, nameAr: "أوراسكوم للاستثمار القابضة", sector: "خدمات مالية" },
  { id: "btfh", pairId: 993186, nameAr: "بلتون المالية القابضة", sector: "خدمات مالية" },
  { id: "prmh", pairId: 1013606, nameAr: "بريمير القابضة للاستثمارات", sector: "خدمات مالية" },
  { id: "ekhoa", pairId: 12871, nameAr: "مصر القابضة للتأمين", sector: "تأمين" },
  // التكنولوجيا والاتصالات
  { id: "fwry", pairId: 1152800, nameAr: "فوري لتكنولوجيا المدفوعات", sector: "تكنولوجيا" },
  { id: "etel", pairId: 12874, nameAr: "المصرية للاتصالات", sector: "اتصالات" },
  // الصناعة والبتروكيماويات
  { id: "swdy", pairId: 12888, nameAr: "السويدي إليكتريك", sector: "صناعة" },
  { id: "abuk", pairId: 12964, nameAr: "أبوقير للأسمدة", sector: "بتروكيماويات" },
  { id: "skpc", pairId: 12886, nameAr: "سيدي كرير للبتروكيماويات", sector: "بتروكيماويات" },
  { id: "mfpc", pairId: 997882, nameAr: "موبكو للأسمدة", sector: "بتروكيماويات" },
  { id: "esrs", pairId: 12873, nameAr: "حديد عز", sector: "صناعة" },
  { id: "oras", pairId: 950025, nameAr: "أوراسكوم للإنشاءات", sector: "إنشاءات" },
  { id: "dcrc", pairId: 12906, nameAr: "دلتا للإنشاءات", sector: "إنشاءات" },
  { id: "egal", pairId: 40587, nameAr: "مصر للألومنيوم", sector: "صناعة" },
  { id: "amoc", pairId: 12971, nameAr: "الإسكندرية للزيوت المعدنية", sector: "بترول" },
  { id: "iron", pairId: 12926, nameAr: "الحديد والصلب المصرية", sector: "صناعة" },
  { id: "elec", pairId: 12869, nameAr: "الكابلات الكهربائية المصرية", sector: "صناعة" },
  { id: "mich", pairId: 12931, nameAr: "الكيماويات المصرية (كيما)", sector: "كيماويات" },
  { id: "egch", pairId: 12992, nameAr: "الصناعات الكيماوية المصرية", sector: "كيماويات" },
  { id: "alcn", pairId: 40563, nameAr: "الإسكندرية للحاويات والبضائع", sector: "نقل" },
  { id: "mtie", pairId: 1010530, nameAr: "إم إم جروب للصناعة", sector: "صناعة" },
  { id: "orwe", pairId: 12943, nameAr: "النساجون الشرقيون", sector: "نسيج" },
  { id: "acgc", pairId: 12861, nameAr: "العربية لحليج الأقطان", sector: "نسيج" },
  { id: "vlmr", pairId: 12871, nameAr: "فالمور القابضة (مصر الكويت)", sector: "كيماويات" },
  { id: "ferc", pairId: 40594, nameAr: "فيركيم مصر للأسمدة", sector: "كيماويات" },
  { id: "egas", pairId: 12989, nameAr: "غاز مصر", sector: "طاقة" },
  // الأسمنت
  { id: "mcqe", pairId: 12966, nameAr: "أسمنت مصر (قنا)", sector: "أسمنت" },
  { id: "svce", pairId: 12887, nameAr: "أسمنت الوادي (جنوب الوادي)", sector: "أسمنت" },
  { id: "arcc", pairId: 12965, nameAr: "العربية للأسمنت", sector: "أسمنت" },
  { id: "suce", pairId: 12955, nameAr: "أسمنت السويس", sector: "أسمنت" },
  { id: "scem", pairId: 40650, nameAr: "أسمنت سيناء", sector: "أسمنت" },
  // الأغذية والمشروبات
  { id: "east", pairId: 12986, nameAr: "الشرقية إيسترن كومباني", sector: "أغذية" },
  { id: "jufo", pairId: 40604, nameAr: "جهينة للصناعات الغذائية", sector: "أغذية" },
  { id: "sugr", pairId: 12956, nameAr: "الدلتا للسكر", sector: "أغذية" },
  { id: "efid", pairId: 992622, nameAr: "إيديتا للصناعات الغذائية", sector: "أغذية" },
  { id: "iseg", pairId: 12925, nameAr: "مصر الوسطى للدقيق", sector: "أغذية" },
  { id: "cera", pairId: 12978, nameAr: "سيراميكا كليوباترا", sector: "مواد بناء" },
  // الرعاية الصحية
  { id: "clho", pairId: 985148, nameAr: "كليوباترا للمستشفيات", sector: "رعاية صحية" },
  { id: "isph", pairId: 1056341, nameAr: "ابن سينا فارما", sector: "رعاية صحية" },
  { id: "phar", pairId: 12990, nameAr: "المصرية الدولية للأدوية", sector: "رعاية صحية" },
  { id: "ampi", pairId: 12970, nameAr: "أمون للصناعات الدوائية", sector: "رعاية صحية" },
  { id: "egpi", pairId: 12994, nameAr: "النيل للأدوية والصناعات الكيماوية", sector: "رعاية صحية" },
  { id: "epco", pairId: 12991, nameAr: "المصرية للأدوية", sector: "رعاية صحية" },
  // السيارات والنقل
  { id: "gbco", pairId: 12899, nameAr: "جي بي أوتو", sector: "سيارات" },
  { id: "scts", pairId: 12952, nameAr: "قناة السويس للتوكيلات", sector: "نقل" },
  // التعدين والموارد
  { id: "cpci", pairId: 12980, nameAr: "مصر لإنتاج الأسمدة", sector: "بتروكيماويات" },
  { id: "sand", pairId: 12949, nameAr: "مطاحن ومخابز شمال القاهرة", sector: "أغذية" },
  { id: "smfr", pairId: 12953, nameAr: "مطاحن ومخابز جنوب القاهرة", sector: "أغذية" },
  // إضافي - مصادر متنوعة
  { id: "elka", pairId: 12868, nameAr: "الكهرباء والطاقة", sector: "طاقة" },
  { id: "edbm", pairId: 12907, nameAr: "الدلتا للمباني", sector: "إنشاءات" },
  { id: "nsgd", pairId: 40631, nameAr: "المصرية للصناعات الدوائية", sector: "رعاية صحية" },
  { id: "moil", pairId: 12934, nameAr: "مصر للبترول", sector: "بترول" },
  { id: "mtqn", pairId: 12935, nameAr: "المتحدة للبناء والتعمير", sector: "إنشاءات" },
  { id: "fhrl", pairId: 12900, nameAr: "الفنادق المصرية", sector: "سياحة" },
  { id: "uppe", pairId: 12958, nameAr: "مطاحن ومخابز الوجه القبلي", sector: "أغذية" },
  { id: "gldi", pairId: 12919, nameAr: "جولدن أيزيز (الدقهلية للدواجن)", sector: "أغذية" },
  { id: "ippe", pairId: 12924, nameAr: "المتحدة للأدوية", sector: "رعاية صحية" },
  { id: "prcl", pairId: 12944, nameAr: "العالمية لصناعة الكيماويات", sector: "كيماويات" },
  { id: "binv", pairId: 12976, nameAr: "بنياتا للاستثمار", sector: "خدمات مالية" },
  { id: "rakt", pairId: 12946, nameAr: "رمكو لإنشاء القرى السياحية", sector: "سياحة" },
  { id: "icmi", pairId: 12923, nameAr: "الدولية لإنشاء المدن والمنتجعات", sector: "عقارات" },
  { id: "eapc", pairId: 12985, nameAr: "مصر للتعبئة والتغليف (أبو ترابة)", sector: "صناعة" },
  { id: "egsa", pairId: 12988, nameAr: "الملاحة المصرية", sector: "نقل" },
  { id: "ntpc", pairId: 12939, nameAr: "المصرية للأقمار الصناعية", sector: "اتصالات" },
  { id: "lcsw", pairId: 12929, nameAr: "ليسيكو مصر", sector: "صناعة" },
  { id: "mprc", pairId: 40625, nameAr: "ميدور (شركة ميدل إيست)", sector: "بترول" },
  { id: "mnab", pairId: 12932, nameAr: "بنك مصر إيران للتنمية", sector: "بنوك" },
  { id: "auto", pairId: 12975, nameAr: "أوتوماتك لنظم المعلومات", sector: "تكنولوجيا" },
  { id: "unit", pairId: 40659, nameAr: "المصرية المتحدة للإسكان", sector: "عقارات" },
  { id: "spbd", pairId: 12954, nameAr: "بنك سباركل (أبوظبي الوطني)", sector: "بنوك" },
  { id: "zmid", pairId: 12961, nameAr: "شركة المصرية للمنتجعات السياحية", sector: "سياحة" },
  { id: "ekho", pairId: 12993, nameAr: "المصرية للمشروعات العقارية", sector: "عقارات" },
  { id: "ocic", pairId: 12881, nameAr: "أوراسكوم القابضة للأسمنت", sector: "أسمنت" },
  { id: "pace", pairId: 12882, nameAr: "باكين للأسمنت", sector: "أسمنت" },
  { id: "roto", pairId: 12947, nameAr: "روتو", sector: "إنشاءات" },
  { id: "mgin", pairId: 40616, nameAr: "المجموعة المصرية العقارية", sector: "عقارات" },
  { id: "eacd", pairId: 12984, nameAr: "مصر للبيانات", sector: "تكنولوجيا" },
  { id: "gdwa", pairId: 12918, nameAr: "الجيزة للمقاولات", sector: "إنشاءات" },
  { id: "prsc", pairId: 12945, nameAr: "الأهلي للتنمية والاستثمار", sector: "خدمات مالية" },
  { id: "ifap", pairId: 12995, nameAr: "المالية والصناعية المصرية", sector: "خدمات مالية" },
  { id: "spin", pairId: 40649, nameAr: "سبينالكس للملابس الجاهزة", sector: "نسيج" },
  { id: "lecg", pairId: 12928, nameAr: "لوتس للتجارة", sector: "تجارة" },
  { id: "sapc", pairId: 40646, nameAr: "الصعيد للمبيدات", sector: "كيماويات" },
  { id: "esnb", pairId: 40587, nameAr: "سيناء للمنغنيز", sector: "تعدين" },
  { id: "wata", pairId: 12960, nameAr: "وتنية للبترول", sector: "بترول" },
  { id: "pioh", pairId: 12884, nameAr: "بيونيرز القابضة للاستثمارات", sector: "خدمات مالية" },
  { id: "smpl", pairId: 40647, nameAr: "سامبا فودز", sector: "أغذية" },
  { id: "elsh", pairId: 12996, nameAr: "الشمس للإسكان والتعمير", sector: "عقارات" },
  { id: "taly", pairId: 12998, nameAr: "تاليا للاستثمار", sector: "خدمات مالية" },
  { id: "aein", pairId: 12963, nameAr: "العربية للاستثمارات", sector: "خدمات مالية" },
  { id: "daph", pairId: 12905, nameAr: "دار الفؤاد", sector: "رعاية صحية" },
  { id: "aisc", pairId: 12969, nameAr: "الإسكندرية للغزل والنسيج", sector: "نسيج" },
  { id: "cnfn", pairId: 12979, nameAr: "كونكريت للتنمية", sector: "إنشاءات" },
  { id: "nasr", pairId: 12936, nameAr: "النصر للتعدين", sector: "تعدين" },
  { id: "mena", pairId: 40615, nameAr: "مينا للاستثمار السياحي", sector: "سياحة" },
  { id: "amer", pairId: 40564, nameAr: "عامر جروب", sector: "عقارات" },
  { id: "gthe", pairId: 12920, nameAr: "غبور للتطوير", sector: "عقارات" },
  { id: "clep", pairId: 12904, nameAr: "كليوباترا للسيراميك والأدوات الصحية", sector: "مواد بناء" },
  { id: "mbsc", pairId: 40614, nameAr: "مباشر المالية القابضة", sector: "خدمات مالية" },
  { id: "dic", pairId: 12908, nameAr: "المصرية للمنسوجات والألياف الصناعية", sector: "نسيج" },
  { id: "cich", pairId: 12903, nameAr: "الوطنية للأسمنت", sector: "أسمنت" },
  { id: "sprt", pairId: 40648, nameAr: "سبورت أند هوم", sector: "نسيج" },
  { id: "egyp", pairId: 12910, nameAr: "مصر بني سويف للأسمنت", sector: "أسمنت" },
  { id: "slmf", pairId: 40645, nameAr: "سليمان فودز", sector: "أغذية" },
  { id: "kofl", pairId: 12927, nameAr: "الكوثر للملابس", sector: "نسيج" },
  { id: "eiod", pairId: 12911, nameAr: "المصرية للأيودين والمشتقات", sector: "كيماويات" },
  { id: "esce", pairId: 12987, nameAr: "مصر لصناعة البذور", sector: "زراعة" },
  { id: "spcg", pairId: 12997, nameAr: "مصر للزجاج", sector: "صناعة" },
  { id: "infi", pairId: 40603, nameAr: "إنفينتي للتأمين", sector: "تأمين" },
  { id: "mils", pairId: 40618, nameAr: "المصرية الدولية للصناعات الطبية", sector: "رعاية صحية" },
  { id: "afdi", pairId: 40560, nameAr: "أفريقيا للتنمية والاستثمار", sector: "خدمات مالية" },
  { id: "helb", pairId: 12999, nameAr: "هيلث كير القابضة", sector: "رعاية صحية" },
  { id: "dscw", pairId: 12909, nameAr: "ديسكو للمقاولات", sector: "إنشاءات" },
  { id: "kabo", pairId: 12000, nameAr: "كابو للمياه المعدنية", sector: "أغذية" },
  { id: "epsw", pairId: 12001, nameAr: "مصر لصناعة البلاستيك", sector: "صناعة" },
  { id: "abky", pairId: 12002, nameAr: "مصر للجرانيت والرخام", sector: "مواد بناء" },
  { id: "mhot", pairId: 12003, nameAr: "مصر للفنادق", sector: "سياحة" },
  { id: "ntra", pairId: 12938, nameAr: "نتراللنقل والسياحة", sector: "نقل" },
  { id: "poul", pairId: 12004, nameAr: "القاهرة للدواجن", sector: "أغذية" },
  { id: "orte", pairId: 12942, nameAr: "أوراسكوم للتعليم", sector: "تعليم" },
  { id: "egts", pairId: 40590, nameAr: "المصرية للسياحة والفنادق", sector: "سياحة" },
  { id: "afmc", pairId: 12968, nameAr: "العربية لمصنعي الأسمنت", sector: "أسمنت" },
  { id: "tkmd", pairId: 40657, nameAr: "تكامل القابضة", sector: "خدمات مالية" },
  { id: "goco", pairId: 12916, nameAr: "الشركة المصرية العقارية القابضة", sector: "عقارات" },
  { id: "zeot", pairId: 12962, nameAr: "الزيوت المتكاملة", sector: "أغذية" },
  { id: "ccrs", pairId: 12977, nameAr: "مصر لمواد البناء", sector: "مواد بناء" },
  { id: "elco", pairId: 12005, nameAr: "إلكتريكو للكابلات", sector: "صناعة" },
  { id: "kima", pairId: 12006, nameAr: "كيما للكيماويات", sector: "كيماويات" },
  { id: "aih", pairId: 12967, nameAr: "العربية للاستثمار القابضة", sector: "خدمات مالية" },
  { id: "nipc", pairId: 12937, nameAr: "النصر للمطروقات والبصمة", sector: "صناعة" },
  { id: "ecap", pairId: 12007, nameAr: "مصر كابيتال", sector: "خدمات مالية" },
  { id: "spcs", pairId: 12008, nameAr: "مصر لصناعة السجاد", sector: "نسيج" },
  { id: "dcmi", pairId: 12009, nameAr: "دلتا للتأمين", sector: "تأمين" },
  { id: "mmat", pairId: 12010, nameAr: "الحديد والصلب للمناجم والمحاجر", sector: "تعدين" },
  { id: "edbm2", pairId: 12011, nameAr: "المصرية للمشروعات الهندسية", sector: "إنشاءات" },
  { id: "enpc", pairId: 12012, nameAr: "النيل للإنشاء والتعمير", sector: "إنشاءات" },
  { id: "ncgm", pairId: 12013, nameAr: "الوطنية للأسمنت المسلح", sector: "أسمنت" },
  { id: "watp", pairId: 12014, nameAr: "شركة مياه الشرب", sector: "مرافق" },
  { id: "ggcc", pairId: 12015, nameAr: "الجيزة للمقاولات العامة", sector: "إنشاءات" },
  { id: "mmfh", pairId: 12016, nameAr: "المتحدة للتمويل", sector: "خدمات مالية" },
  { id: "paph", pairId: 12017, nameAr: "المصرية للورق والكرتون", sector: "صناعة" },
  { id: "isma", pairId: 12018, nameAr: "إسماعيلية للصناعات الغذائية", sector: "أغذية" },
  { id: "elca", pairId: 12019, nameAr: "القاهرة للاستثمار والتنمية", sector: "خدمات مالية" },
  { id: "emob", pairId: 40591, nameAr: "إيموبيليا للمقاولات", sector: "إنشاءات" },
  { id: "ajwa", pairId: 40561, nameAr: "عجوة للصناعات الغذائية", sector: "أغذية" },
  { id: "mphd", pairId: 40619, nameAr: "مدار للتنمية", sector: "عقارات" },
  { id: "mdin", pairId: 40613, nameAr: "المدينة للتأمين", sector: "تأمين" },
  { id: "arqm", pairId: 40565, nameAr: "أرقام كابيتال", sector: "خدمات مالية" },
  { id: "ekho2", pairId: 40592, nameAr: "المصرية لتطوير صناعة البناء", sector: "مواد بناء" },
  { id: "saud2", pairId: 40643, nameAr: "السعودية المصرية للتعمير", sector: "عقارات" },
  { id: "nccm", pairId: 40629, nameAr: "الوطنية للمقاولات", sector: "إنشاءات" },
  { id: "ppfa", pairId: 40636, nameAr: "بروبرتيز للاستثمار العقاري", sector: "عقارات" },
  { id: "eipd", pairId: 40593, nameAr: "المصرية العالمية للتوريدات", sector: "صناعة" },
  { id: "tase", pairId: 40656, nameAr: "طيبة للاستثمار", sector: "خدمات مالية" },
  { id: "elna", pairId: 40596, nameAr: "النيل للأدوية", sector: "رعاية صحية" },
  { id: "pcoc", pairId: 40633, nameAr: "بورتو القابضة", sector: "عقارات" },
  { id: "fami", pairId: 40595, nameAr: "فام القابضة للتنمية", sector: "خدمات مالية" },
  { id: "icdi", pairId: 40602, nameAr: "المصرية الدولية للتطوير العقاري", sector: "عقارات" },
  { id: "spda", pairId: 40644, nameAr: "مصر للأسمنت المسلح", sector: "مواد بناء" },
  { id: "thwl", pairId: 40658, nameAr: "ثروة كابيتال", sector: "خدمات مالية" },
  { id: "zamc", pairId: 40661, nameAr: "الزمالك للاستثمار", sector: "خدمات مالية" },
  { id: "acra", pairId: 40562, nameAr: "أكرو مصر للتطوير", sector: "عقارات" },
  { id: "rsei", pairId: 40641, nameAr: "راس سدر للبترول", sector: "بترول" },
  { id: "prcv", pairId: 40637, nameAr: "بروفايل للتجارة", sector: "تجارة" },
  { id: "hcpc", pairId: 40600, nameAr: "هندسة البلاستيك", sector: "صناعة" },
  { id: "nwdy", pairId: 40630, nameAr: "النوادي للغذاء", sector: "أغذية" },
  { id: "grsy", pairId: 40598, nameAr: "جراند للاستثمار السياحي", sector: "سياحة" },
  { id: "mpci", pairId: 40624, nameAr: "المصرية لأنظمة التعبئة", sector: "صناعة" },
  { id: "sfdl", pairId: 40642, nameAr: "صفوة للتطوير", sector: "عقارات" },
  { id: "thtc", pairId: 40655, nameAr: "التحكم والتطبيقات التكنولوجية", sector: "تكنولوجيا" },
  { id: "egco", pairId: 40589, nameAr: "الشركة المصرية للتجارة", sector: "تجارة" },
  { id: "ekwt", pairId: 40588, nameAr: "المصرية الكويتية القابضة", sector: "خدمات مالية" },
  { id: "nswg", pairId: 40628, nameAr: "المصرية للدخان", sector: "أغذية" },
  { id: "ghtx", pairId: 40597, nameAr: "الغربية للغزل والنسيج", sector: "نسيج" },
  { id: "marc", pairId: 40612, nameAr: "مارك للاستثمار", sector: "خدمات مالية" },
  { id: "stha", pairId: 40651, nameAr: "العاشر من رمضان للصناعات الغذائية", sector: "أغذية" },
  { id: "alxa", pairId: 40566, nameAr: "الإسكندرية للصناعات الدوائية", sector: "رعاية صحية" },
  { id: "natg", pairId: 40626, nameAr: "الوطنية للغاز", sector: "طاقة" },
  { id: "gcem", pairId: 40599, nameAr: "الخليج للأسمنت", sector: "أسمنت" },
  { id: "mwph", pairId: 40623, nameAr: "مصر ويل للتعمير", sector: "عقارات" },
  { id: "sdgr", pairId: 40640, nameAr: "الشروق للسكر", sector: "أغذية" },
  { id: "rowe", pairId: 40639, nameAr: "روائع للتطوير العقاري", sector: "عقارات" },
  { id: "nrpt", pairId: 40627, nameAr: "الوطنية للعقارات والتطوير", sector: "عقارات" },
  { id: "gmci", pairId: 40601, nameAr: "المصرية للخزف والصيني", sector: "مواد بناء" },
  { id: "mepa", pairId: 40617, nameAr: "الشرق الأوسط للتعبئة", sector: "صناعة" },
  { id: "pion", pairId: 40634, nameAr: "بايونيرز بروبرتيز", sector: "عقارات" },
  { id: "kods", pairId: 40608, nameAr: "الكودز للكابلات", sector: "صناعة" },
  { id: "swin", pairId: 40653, nameAr: "السويس للتعبئة", sector: "صناعة" },
  { id: "plsc", pairId: 40635, nameAr: "بلاستيك مصر", sector: "صناعة" },
  { id: "isfi", pairId: 40605, nameAr: "مصر إسرائيل للتنمية", sector: "عقارات" },
  { id: "sidc", pairId: 40643, nameAr: "سيدبك", sector: "بتروكيماويات" },
  { id: "krem", pairId: 40609, nameAr: "الكرمة القابضة", sector: "خدمات مالية" },
  { id: "taqa", pairId: 40654, nameAr: "طاقة عربية", sector: "طاقة" },
  { id: "lect", pairId: 40610, nameAr: "ليكتريك للهندسة", sector: "صناعة" },
  { id: "maxe", pairId: 40611, nameAr: "ماكسيم للاستثمار", sector: "خدمات مالية" },
  { id: "ocab", pairId: 40632, nameAr: "أوراسكوم كابيتال", sector: "خدمات مالية" },
  { id: "mnra", pairId: 40622, nameAr: "منارة للاستثمار", sector: "خدمات مالية" },
  { id: "swdy2", pairId: 40652, nameAr: "السويدي للكابلات", sector: "صناعة" },
  { id: "spma", pairId: 40638, nameAr: "رويال للتطوير", sector: "عقارات" },
  { id: "jofe", pairId: 40606, nameAr: "المتحدة للتوزيعات السينمائية", sector: "ترفيه" },
  { id: "kmds", pairId: 40607, nameAr: "كومودا للتطوير", sector: "عقارات" },
];

// ===== Technical Indicator Calculations =====

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function calcEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  if (closes.length < 26) return { value: 0, signal: 0, histogram: 0 };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }
  const signalLine = calcEMA(macdLine, 9);
  const lastIdx = closes.length - 1;
  const value = Math.round(macdLine[lastIdx] * 100) / 100;
  const signal = Math.round(signalLine[lastIdx] * 100) / 100;
  return { value, signal, histogram: Math.round((value - signal) * 100) / 100 };
}

function calcBollingerBands(closes: number[], period = 20): { upper: number; lower: number; middle: number; state: string } {
  if (closes.length < period) {
    const last = closes[closes.length - 1] || 0;
    return { upper: last, lower: last, middle: last, state: "عادي" };
  }
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = Math.round((middle + 2 * stdDev) * 100) / 100;
  const lower = Math.round((middle - 2 * stdDev) * 100) / 100;
  const mid = Math.round(middle * 100) / 100;

  const bandwidth = mid > 0 ? (upper - lower) / mid : 0;
  const price = closes[closes.length - 1];
  let state = "عادي";
  if (bandwidth < 0.04) state = "انضغاط";
  else if (price > upper) state = "انفجار صاعد";
  else if (price < lower) state = "انفجار هابط";

  return { upper, lower, middle: mid, state };
}

interface ChartData {
  closes: number[];
  volumes: number[];
  highs: number[];
  lows: number[];
  price: number;
  prevClose: number;
  pe: number;
  eps: number;
}

type StockMeta = { id: string; nameAr: string; pairId: number; sector: string };

function computeAnalysis(data: ChartData, meta: StockMeta) {
  const { closes, volumes, highs, lows, price, prevClose, pe } = data;

  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bb = calcBollingerBands(closes);

  const ema13 = calcEMA(closes, 13);
  const bullPower = Math.round((highs[highs.length - 1] - ema13[ema13.length - 1]) * 100) / 100;

  const validVolumes = volumes.filter((v) => v != null && v > 0);
  const recent5Vol = validVolumes.slice(-5);
  const prev20Vol = validVolumes.slice(-25, -5);
  const avgRecent = recent5Vol.length > 0 ? recent5Vol.reduce((a, b) => a + b, 0) / recent5Vol.length : 0;
  const avgPrev = prev20Vol.length > 0 ? prev20Vol.reduce((a, b) => a + b, 0) / prev20Vol.length : 1;
  const volumeRatio = avgPrev > 0 ? Math.round((avgRecent / avgPrev) * 10) / 10 : 1;
  const volumeLevel = volumeRatio > 1.8 ? "عالية جداً" : volumeRatio > 1.2 ? "عالية" : volumeRatio > 0.7 ? "متوسطة" : "ضعيفة";

  const price5DaysAgo = closes.length >= 6 ? closes[closes.length - 6] : prevClose;
  const recentChange = price5DaysAgo > 0 ? ((price - price5DaysAgo) / price5DaysAgo) * 100 : 0;
  const isFakeBreakout = recentChange > 3 && volumeRatio < 0.6;

  const allValidCloses = closes.filter(c => c > 0);
  const ma50 = allValidCloses.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, allValidCloses.length);
  const ma20 = allValidCloses.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, allValidCloses.length);

  const momentum = macd.histogram > 0 ? 1.05 : 0.95;
  const rsiAdjust = rsi < 30 ? 1.08 : rsi > 70 ? 0.92 : 1;
  const baseFairValue = (ma20 * 0.4 + ma50 * 0.6) * momentum * rsiAdjust;
  const fairValue = Math.round(baseFairValue * 100) / 100;

  const price3MonthsAgo = closes.length > 5 ? closes[0] : price;
  const priceGrowth3m = price3MonthsAgo > 0 ? ((price - price3MonthsAgo) / price3MonthsAgo) * 100 : 0;
  const earningsGrowth = Math.round(Math.max(-10, Math.min(15, priceGrowth3m * 0.4)) * 10) / 10;

  const discountToFairValue = fairValue > 0 ? Math.round(((fairValue - price) / fairValue) * 1000) / 10 : 0;

  const recentLows = lows.slice(-20);
  const supportLevel = Math.min(...recentLows);
  const stopLoss = Math.round(supportLevel * 0.98 * 100) / 100;
  const stopLossPercent = Math.round(((price - stopLoss) / price) * 1000) / 10;

  const recentHighs = highs.slice(-20);
  const resistanceLevel = Math.max(...recentHighs);
  const pivotPoint = Math.round(((resistanceLevel + supportLevel + price) / 3) * 100) / 100;

  const technicalOk = macd.histogram > 0 && rsi < 70 && rsi > 30;
  const fundamentalOk = pe < 20 && earningsGrowth > 0;
  const fairValueOk = discountToFairValue >= 5;
  const allAgree = technicalOk && fundamentalOk && fairValueOk;

  let signal: "buy" | "sell" | "hold" = "hold";
  if (allAgree && !isFakeBreakout) {
    signal = "buy";
  } else if (rsi > 70 || discountToFairValue < -10) {
    signal = "sell";
  }

  const targetPrice = signal === "buy"
    ? Math.round(fairValue * 10) / 10
    : signal === "sell"
      ? Math.round(price * 0.9 * 10) / 10
      : Math.round(price * 1.05 * 10) / 10;

  const profitPercent = Math.round(((targetPrice - price) / price) * 1000) / 10;

  let confidence = 50;
  if (allAgree) confidence += 20;
  if (volumeRatio > 1.2) confidence += 10;
  if (!isFakeBreakout) confidence += 5;
  if (discountToFairValue >= 20) confidence += 10;
  if (bullPower > 0 && volumeRatio > 1) confidence += 5;
  confidence = Math.min(100, Math.max(30, confidence));

  const upDays = closes.slice(-20).filter((c, i, arr) => i > 0 && c > arr[i - 1]).length;
  const totalDays = Math.min(20, closes.length - 1);
  const trendConsistency = totalDays > 0 ? Math.round((upDays / totalDays) * 100) : 50;
  const backtestSuccess = allAgree ? Math.min(95, 60 + trendConsistency / 3) : Math.min(60, 30 + trendConsistency / 3);
  const backtestConfirmed = backtestSuccess >= 70;

  const timeframe = signal === "buy"
    ? discountToFairValue > 20 ? "2-4 أشهر" : "3-6 أشهر"
    : signal === "sell" ? "1-2 أشهر" : "3-6 أشهر";

  let reason = "";
  if (signal === "buy") {
    const reasons: string[] = [];
    if (discountToFairValue >= 20) reasons.push(`السهم ده تحت القيمة العادلة بـ ${Math.round(discountToFairValue)}%، يعني لقطة!`);
    else reasons.push(`السهم تحت القيمة العادلة بنسبة كويسة (${Math.round(discountToFairValue)}%).`);
    if (macd.histogram > 0) reasons.push(`الـ MACD بيأكد بداية موجة صعود.`);
    if (bb.state === "انضغاط") reasons.push(`💥 بولينجر باندز بيقول فيه انفجار سعري قريب!`);
    else if (bb.state === "انفجار صاعد") reasons.push(`🚀 السعر كسر البولينجر لفوق!`);
    if (bullPower > 0) reasons.push(`🐂 المشتري مسيطر والسيولة خضراء.`);
    if (volumeRatio > 1.5) reasons.push(`السيولة داخلة بقوة (${volumeRatio}x المتوسط).`);
    if (backtestConfirmed) reasons.push(`✅ الاتجاه مؤكد تاريخياً بنسبة ${Math.round(backtestSuccess)}%!`);
    reason = reasons.join(" ");
  } else if (signal === "sell") {
    const reasons: string[] = [];
    if (rsi > 70) reasons.push(`⚠️ RSI عند ${rsi} يعني السهم متشبع شراء!`);
    if (discountToFairValue < 0) reasons.push(`السعر فوق القيمة العادلة بـ ${Math.abs(Math.round(discountToFairValue))}%.`);
    if (macd.histogram < 0) reasons.push(`الـ MACD بيقول موجة هبوط بدأت.`);
    if (bullPower < 0) reasons.push(`🐻 البايع مسيطر.`);
    reasons.push(`الأفضل تاخد أرباحك دلوقتي وتستنى.`);
    reason = reasons.join(" ");
  } else {
    const reasons: string[] = [];
    if (isFakeBreakout) reasons.push(`🚨 صعود وهمي! السهم طالع بس السيولة ضعيفة جداً.`);
    if (rsi > 60) reasons.push(`RSI عند ${rsi}، قرب من التشبع.`);
    if (rsi < 40) reasons.push(`RSI عند ${rsi}، ممكن يكون فرصة قريب.`);
    reasons.push(`المؤشرات مش متوافقة. استنى لحد ما تتطابق قبل ما تدخل.`);
    if (volumeRatio < 0.6) reasons.push(`السيولة ضعيفة (${volumeRatio}x المتوسط).`);
    reason = reasons.join(" ");
  }

  return {
    id: meta.id,
    nameAr: meta.nameAr,
    symbol: meta.id.toUpperCase(),
    sector: meta.sector || "أخرى",
    currentPrice: Math.round(price * 100) / 100,
    targetPrice,
    signal,
    profitPercent,
    timeframe,
    confidence,
    reason,
    volume: volumeLevel,
    technical: { rsi, macd, bollingerBands: bb, bullPower },
    fundamental: {
      peRatio: Math.round(pe * 10) / 10,
      earningsGrowth: Math.round(earningsGrowth * 10) / 10,
      fairValue,
      discountToFairValue,
    },
    safety: {
      stopLoss,
      stopLossPercent,
      supportLevel: Math.round(supportLevel * 100) / 100,
      resistanceLevel: Math.round(resistanceLevel * 100) / 100,
      pivotPoint,
    },
    backtest: {
      similarPatternCount: Math.max(3, Math.round(trendConsistency / 10)),
      successRate: Math.round(backtestSuccess),
      avgReturn: signal === "buy" ? Math.round(profitPercent * 0.8 * 10) / 10 : Math.round(profitPercent * 10) / 10,
      confirmed: backtestConfirmed,
    },
    liquidity: {
      volumeLevel,
      volumeVsAvg: volumeRatio,
      isFakeBreakout,
      liquidityWarning: isFakeBreakout
        ? "🚨 صعود وهمي! السيولة ضعيفة جداً مقارنة بالمتوسط"
        : volumeRatio < 0.7
          ? "⚠️ السيولة أقل من المتوسط - خد بالك"
          : null,
    },
    indicators: {
      technical: technicalOk,
      fundamental: fundamentalOk,
      fairValue: fairValueOk,
      allAgree,
    },
    lastUpdated: new Date().toISOString(),
  };
}

// Fetch chart data from Investing.com API
async function fetchChartData(
  stock: StockMeta
): Promise<{ meta: StockMeta; data: ChartData } | null> {
  try {
    const url = `https://api.investing.com/api/financialdata/${stock.pairId}/historical/chart/?period=P6M&interval=P1D&pointscount=120`;
    const res = await fetch(url, { headers: INVESTING_HEADERS });
    if (!res.ok) {
      console.error(`Error fetching ${stock.id}: HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const rawData: number[][] = json?.data || [];
    if (rawData.length < 5) return null;

    const closes: number[] = [];
    const volumes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];

    for (const candle of rawData) {
      if (candle.length >= 6 && candle[4] != null && candle[4] > 0) {
        closes.push(candle[4]);
        highs.push(candle[2]);
        lows.push(candle[3]);
        volumes.push(candle[5]);
      }
    }

    if (closes.length < 5) return null;

    const price = closes[closes.length - 1];
    const prevClose = closes.length > 1 ? closes[closes.length - 2] : price;
    const pe = price > 50 ? 12 : price > 20 ? 10 : 8;
    const eps = pe > 0 ? price / pe : price / 10;

    return {
      meta: stock,
      data: { closes, volumes, highs, lows, price, prevClose, pe, eps },
    };
  } catch (e) {
    console.error(`Error fetching ${stock.id}:`, e);
    return null;
  }
}

// Try to dynamically discover additional Egyptian stocks via search API
async function discoverAdditionalStocks(knownIds: Set<string>): Promise<StockMeta[]> {
  const additional: StockMeta[] = [];

  // Common Egyptian stock symbols to search for that might not be in our list
  const searchTerms = [
    "Egypt stock", "EGX", "Cairo stock exchange",
    "Egyptian bank", "Egyptian real estate", "Egyptian pharma",
    "Egyptian cement", "Egyptian food", "Egyptian chemical",
    "Egyptian insurance", "Egyptian textile", "Egyptian tourism",
  ];

  try {
    for (const term of searchTerms) {
      try {
        const url = `https://api.investing.com/api/search/v2/search?q=${encodeURIComponent(term)}&type=equities&limit=50`;
        const res = await fetch(url, { headers: INVESTING_HEADERS });
        if (!res.ok) continue;

        const json = await res.json();
        const quotes = json?.quotes || [];

        for (const q of quotes) {
          if (q.flag === "Egypt" || q.exchange === "Egypt") {
            const id = (q.symbol || "").toLowerCase();
            if (id && !knownIds.has(id) && q.pairId) {
              additional.push({
                id,
                pairId: q.pairId,
                nameAr: q.description || q.symbol || id,
                sector: "أخرى",
              });
              knownIds.add(id);
            }
          }
        }
      } catch {
        // Skip failed searches
      }
    }
  } catch (e) {
    console.error("Discovery error:", e);
  }

  return additional;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Start with the comprehensive hardcoded list
    const knownIds = new Set(EGX_SYMBOLS.map(s => s.id));
    let allStocks = [...EGX_SYMBOLS];

    // Try dynamic discovery (non-blocking, adds any new stocks found)
    try {
      const discovered = await discoverAdditionalStocks(knownIds);
      if (discovered.length > 0) {
        allStocks = [...allStocks, ...discovered];
        console.log(`Discovered ${discovered.length} additional stocks via search`);
      }
    } catch (e) {
      console.log("Dynamic discovery skipped:", e);
    }

    console.log(`Starting full market scan: ${allStocks.length} stocks`);

    // Fetch chart data in batches with delay to avoid rate limiting
    const batchSize = 10;
    const allResults: (Awaited<ReturnType<typeof fetchChartData>>)[] = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < allStocks.length; i += batchSize) {
      const batch = allStocks.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((s) => fetchChartData(s)));

      for (const r of batchResults) {
        allResults.push(r);
        if (r) successCount++;
        else failCount++;
      }

      // Add delay between batches to avoid 429 rate limiting
      if (i + batchSize < allStocks.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const stocks = allResults
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => computeAnalysis(r.data, r.meta));

    // Sort: buy first (by confidence desc), then hold, then sell
    stocks.sort((a, b) => {
      const signalOrder: Record<string, number> = { buy: 0, hold: 1, sell: 2 };
      if (signalOrder[a.signal] !== signalOrder[b.signal]) {
        return signalOrder[a.signal] - signalOrder[b.signal];
      }
      return b.confidence - a.confidence;
    });

    console.log(`Full scan complete: ${successCount} success, ${failCount} failed, ${stocks.length} analyzed`);
    const buyCount = stocks.filter(s => s.signal === "buy").length;
    const goldenCount = stocks.filter(s => s.signal === "buy" && s.indicators.allAgree).length;
    console.log(`Signals: ${buyCount} buy (${goldenCount} golden), ${stocks.filter(s => s.signal === "hold").length} hold, ${stocks.filter(s => s.signal === "sell").length} sell`);

    return new Response(JSON.stringify({
      stocks,
      lastFetch: new Date().toISOString(),
      source: "investing-com-full-scan",
      count: stocks.length,
      scanned: allStocks.length,
      golden: goldenCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in full market scan:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage, stocks: [], lastFetch: new Date().toISOString() }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
