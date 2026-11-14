// A built-in copy of the world's major airports (ICAO code, IATA code, name, city, country), so a code or a name can be found at once without
// asking a server. The flight page searches this first and only goes online (OpenStreetMap) when nothing here matches. A UMD module: used by the
// page and by the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.FlightAirports = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ICAO|IATA|name|city|country
  const RAW = `
KATL|ATL|Hartsfield-Jackson Atlanta International Airport|Atlanta|United States
KLAX|LAX|Los Angeles International Airport|Los Angeles|United States
KORD|ORD|Chicago O'Hare International Airport|Chicago|United States
KDFW|DFW|Dallas/Fort Worth International Airport|Dallas|United States
KDEN|DEN|Denver International Airport|Denver|United States
KJFK|JFK|John F. Kennedy International Airport|New York|United States
KEWR|EWR|Newark Liberty International Airport|Newark|United States
KLGA|LGA|LaGuardia Airport|New York|United States
KSFO|SFO|San Francisco International Airport|San Francisco|United States
KSEA|SEA|Seattle-Tacoma International Airport|Seattle|United States
KLAS|LAS|Harry Reid International Airport|Las Vegas|United States
KMCO|MCO|Orlando International Airport|Orlando|United States
KMIA|MIA|Miami International Airport|Miami|United States
KPHX|PHX|Phoenix Sky Harbor International Airport|Phoenix|United States
KIAH|IAH|George Bush Intercontinental Airport|Houston|United States
KBOS|BOS|Boston Logan International Airport|Boston|United States
KMSP|MSP|Minneapolis-Saint Paul International Airport|Minneapolis|United States
KDTW|DTW|Detroit Metropolitan Wayne County Airport|Detroit|United States
KPHL|PHL|Philadelphia International Airport|Philadelphia|United States
KCLT|CLT|Charlotte Douglas International Airport|Charlotte|United States
KBWI|BWI|Baltimore/Washington International Airport|Baltimore|United States
KIAD|IAD|Washington Dulles International Airport|Washington|United States
KDCA|DCA|Ronald Reagan Washington National Airport|Washington|United States
KSAN|SAN|San Diego International Airport|San Diego|United States
KPDX|PDX|Portland International Airport|Portland|United States
KSLC|SLC|Salt Lake City International Airport|Salt Lake City|United States
KTPA|TPA|Tampa International Airport|Tampa|United States
KFLL|FLL|Fort Lauderdale-Hollywood International Airport|Fort Lauderdale|United States
PHNL|HNL|Daniel K. Inouye International Airport|Honolulu|United States
PANC|ANC|Ted Stevens Anchorage International Airport|Anchorage|United States
KMDW|MDW|Chicago Midway International Airport|Chicago|United States
KOAK|OAK|Oakland International Airport|Oakland|United States
KSJC|SJC|San Jose International Airport|San Jose|United States
KAUS|AUS|Austin-Bergstrom International Airport|Austin|United States
KBNA|BNA|Nashville International Airport|Nashville|United States
KSTL|STL|St. Louis Lambert International Airport|St. Louis|United States
KMSY|MSY|Louis Armstrong New Orleans International Airport|New Orleans|United States
KRDU|RDU|Raleigh-Durham International Airport|Raleigh|United States
KPIT|PIT|Pittsburgh International Airport|Pittsburgh|United States
KCLE|CLE|Cleveland Hopkins International Airport|Cleveland|United States
KMCI|MCI|Kansas City International Airport|Kansas City|United States
KSMF|SMF|Sacramento International Airport|Sacramento|United States
KSAT|SAT|San Antonio International Airport|San Antonio|United States
KIND|IND|Indianapolis International Airport|Indianapolis|United States
CYYZ|YYZ|Toronto Pearson International Airport|Toronto|Canada
CYTZ|YTZ|Billy Bishop Toronto City Airport|Toronto|Canada
CYVR|YVR|Vancouver International Airport|Vancouver|Canada
CYUL|YUL|Montreal-Trudeau International Airport|Montreal|Canada
CYYC|YYC|Calgary International Airport|Calgary|Canada
CYEG|YEG|Edmonton International Airport|Edmonton|Canada
CYOW|YOW|Ottawa Macdonald-Cartier International Airport|Ottawa|Canada
CYWG|YWG|Winnipeg James Armstrong Richardson International Airport|Winnipeg|Canada
CYHZ|YHZ|Halifax Stanfield International Airport|Halifax|Canada
MMMX|MEX|Mexico City International Airport|Mexico City|Mexico
MMUN|CUN|Cancun International Airport|Cancun|Mexico
MMGL|GDL|Guadalajara International Airport|Guadalajara|Mexico
MMMY|MTY|Monterrey International Airport|Monterrey|Mexico
MPTO|PTY|Tocumen International Airport|Panama City|Panama
MROC|SJO|Juan Santamaria International Airport|San Jose|Costa Rica
MKJP|KIN|Norman Manley International Airport|Kingston|Jamaica
MYNN|NAS|Lynden Pindling International Airport|Nassau|Bahamas
TJSJ|SJU|Luis Munoz Marin International Airport|San Juan|Puerto Rico
MDPC|PUJ|Punta Cana International Airport|Punta Cana|Dominican Republic
MUHA|HAV|Jose Marti International Airport|Havana|Cuba
SBGR|GRU|Sao Paulo/Guarulhos International Airport|Sao Paulo|Brazil
SBSP|CGH|Sao Paulo-Congonhas Airport|Sao Paulo|Brazil
SBGL|GIG|Rio de Janeiro/Galeao International Airport|Rio de Janeiro|Brazil
SBBR|BSB|Brasilia International Airport|Brasilia|Brazil
SAEZ|EZE|Ministro Pistarini International Airport|Buenos Aires|Argentina
SABE|AEP|Aeroparque Jorge Newbery|Buenos Aires|Argentina
SCEL|SCL|Arturo Merino Benitez International Airport|Santiago|Chile
SPJC|LIM|Jorge Chavez International Airport|Lima|Peru
SKBO|BOG|El Dorado International Airport|Bogota|Colombia
SEQM|UIO|Mariscal Sucre International Airport|Quito|Ecuador
SVMI|CCS|Simon Bolivar International Airport|Caracas|Venezuela
SUMU|MVD|Carrasco International Airport|Montevideo|Uruguay
SLLP|LPB|El Alto International Airport|La Paz|Bolivia
EGLL|LHR|London Heathrow Airport|London|United Kingdom
EGKK|LGW|London Gatwick Airport|London|United Kingdom
EGSS|STN|London Stansted Airport|London|United Kingdom
EGGW|LTN|London Luton Airport|London|United Kingdom
EGLC|LCY|London City Airport|London|United Kingdom
EGCC|MAN|Manchester Airport|Manchester|United Kingdom
EGBB|BHX|Birmingham Airport|Birmingham|United Kingdom
EGPH|EDI|Edinburgh Airport|Edinburgh|United Kingdom
EGPF|GLA|Glasgow Airport|Glasgow|United Kingdom
EIDW|DUB|Dublin Airport|Dublin|Ireland
LFPG|CDG|Paris Charles de Gaulle Airport|Paris|France
LFPO|ORY|Paris Orly Airport|Paris|France
LFMN|NCE|Nice Cote d'Azur Airport|Nice|France
LFML|MRS|Marseille Provence Airport|Marseille|France
LFLL|LYS|Lyon-Saint-Exupery Airport|Lyon|France
LFBO|TLS|Toulouse-Blagnac Airport|Toulouse|France
EHAM|AMS|Amsterdam Airport Schiphol|Amsterdam|Netherlands
EBBR|BRU|Brussels Airport|Brussels|Belgium
EDDF|FRA|Frankfurt Airport|Frankfurt|Germany
EDDM|MUC|Munich Airport|Munich|Germany
EDDB|BER|Berlin Brandenburg Airport|Berlin|Germany
EDDL|DUS|Dusseldorf Airport|Dusseldorf|Germany
EDDH|HAM|Hamburg Airport|Hamburg|Germany
EDDK|CGN|Cologne Bonn Airport|Cologne|Germany
EDDS|STR|Stuttgart Airport|Stuttgart|Germany
LSZH|ZRH|Zurich Airport|Zurich|Switzerland
LSGG|GVA|Geneva Airport|Geneva|Switzerland
LOWW|VIE|Vienna International Airport|Vienna|Austria
LEMD|MAD|Madrid-Barajas Airport|Madrid|Spain
LEBL|BCN|Barcelona-El Prat Airport|Barcelona|Spain
LEPA|PMI|Palma de Mallorca Airport|Palma de Mallorca|Spain
LEMG|AGP|Malaga Airport|Malaga|Spain
LEAL|ALC|Alicante-Elche Airport|Alicante|Spain
LPPT|LIS|Lisbon Humberto Delgado Airport|Lisbon|Portugal
LPPR|OPO|Porto Francisco Sa Carneiro Airport|Porto|Portugal
LIRF|FCO|Rome Fiumicino Leonardo da Vinci Airport|Rome|Italy
LIMC|MXP|Milan Malpensa Airport|Milan|Italy
LIML|LIN|Milan Linate Airport|Milan|Italy
LIPZ|VCE|Venice Marco Polo Airport|Venice|Italy
LIRN|NAP|Naples International Airport|Naples|Italy
LIPE|BLQ|Bologna Guglielmo Marconi Airport|Bologna|Italy
LGAV|ATH|Athens Eleftherios Venizelos Airport|Athens|Greece
LTFM|IST|Istanbul Airport|Istanbul|Turkey
LTFJ|SAW|Istanbul Sabiha Gokcen Airport|Istanbul|Turkey
LTAI|AYT|Antalya Airport|Antalya|Turkey
EKCH|CPH|Copenhagen Airport|Copenhagen|Denmark
ESSA|ARN|Stockholm Arlanda Airport|Stockholm|Sweden
ENGM|OSL|Oslo Gardermoen Airport|Oslo|Norway
EFHK|HEL|Helsinki-Vantaa Airport|Helsinki|Finland
BIKF|KEF|Keflavik International Airport|Reykjavik|Iceland
EPWA|WAW|Warsaw Chopin Airport|Warsaw|Poland
LKPR|PRG|Vaclav Havel Airport Prague|Prague|Czechia
LHBP|BUD|Budapest Ferenc Liszt International Airport|Budapest|Hungary
LROP|OTP|Bucharest Henri Coanda International Airport|Bucharest|Romania
LBSF|SOF|Sofia Airport|Sofia|Bulgaria
LDZA|ZAG|Zagreb Franjo Tudman Airport|Zagreb|Croatia
LYBE|BEG|Belgrade Nikola Tesla Airport|Belgrade|Serbia
UUEE|SVO|Moscow Sheremetyevo International Airport|Moscow|Russia
UUDD|DME|Moscow Domodedovo International Airport|Moscow|Russia
ULLI|LED|Pulkovo Airport|Saint Petersburg|Russia
EVRA|RIX|Riga International Airport|Riga|Latvia
EYVI|VNO|Vilnius Airport|Vilnius|Lithuania
EETN|TLL|Tallinn Airport|Tallinn|Estonia
UKBB|KBP|Boryspil International Airport|Kyiv|Ukraine
OMDB|DXB|Dubai International Airport|Dubai|United Arab Emirates
OMAA|AUH|Abu Dhabi Zayed International Airport|Abu Dhabi|United Arab Emirates
OTHH|DOH|Hamad International Airport|Doha|Qatar
OERK|RUH|King Khalid International Airport|Riyadh|Saudi Arabia
OEJN|JED|King Abdulaziz International Airport|Jeddah|Saudi Arabia
OKBK|KWI|Kuwait International Airport|Kuwait City|Kuwait
OBBI|BAH|Bahrain International Airport|Manama|Bahrain
OOMS|MCT|Muscat International Airport|Muscat|Oman
LLBG|TLV|Ben Gurion Airport|Tel Aviv|Israel
OJAI|AMM|Queen Alia International Airport|Amman|Jordan
OLBA|BEY|Beirut-Rafic Hariri International Airport|Beirut|Lebanon
OIIE|IKA|Imam Khomeini International Airport|Tehran|Iran
ORBI|BGW|Baghdad International Airport|Baghdad|Iraq
HECA|CAI|Cairo International Airport|Cairo|Egypt
FAOR|JNB|O. R. Tambo International Airport|Johannesburg|South Africa
FACT|CPT|Cape Town International Airport|Cape Town|South Africa
DNMM|LOS|Murtala Muhammed International Airport|Lagos|Nigeria
HKJK|NBO|Jomo Kenyatta International Airport|Nairobi|Kenya
HAAB|ADD|Addis Ababa Bole International Airport|Addis Ababa|Ethiopia
GMMN|CMN|Mohammed V International Airport|Casablanca|Morocco
DTTA|TUN|Tunis-Carthage International Airport|Tunis|Tunisia
DAAG|ALG|Houari Boumediene Airport|Algiers|Algeria
HTDA|DAR|Julius Nyerere International Airport|Dar es Salaam|Tanzania
FIMP|MRU|Sir Seewoosagur Ramgoolam International Airport|Port Louis|Mauritius
GOBD|DSS|Blaise Diagne International Airport|Dakar|Senegal
DGAA|ACC|Kotoka International Airport|Accra|Ghana
HUEN|EBB|Entebbe International Airport|Entebbe|Uganda
VHHH|HKG|Hong Kong International Airport|Hong Kong|Hong Kong
ZGGG|CAN|Guangzhou Baiyun International Airport|Guangzhou|China
ZGSZ|SZX|Shenzhen Bao'an International Airport|Shenzhen|China
ZSPD|PVG|Shanghai Pudong International Airport|Shanghai|China
ZSSS|SHA|Shanghai Hongqiao International Airport|Shanghai|China
ZBAA|PEK|Beijing Capital International Airport|Beijing|China
ZBAD|PKX|Beijing Daxing International Airport|Beijing|China
ZUUU|CTU|Chengdu Shuangliu International Airport|Chengdu|China
ZUTF|TFU|Chengdu Tianfu International Airport|Chengdu|China
ZUCK|CKG|Chongqing Jiangbei International Airport|Chongqing|China
ZSHC|HGH|Hangzhou Xiaoshan International Airport|Hangzhou|China
ZSNJ|NKG|Nanjing Lukou International Airport|Nanjing|China
ZHHH|WUH|Wuhan Tianhe International Airport|Wuhan|China
ZLXY|XIY|Xi'an Xianyang International Airport|Xi'an|China
ZGHA|CSX|Changsha Huanghua International Airport|Changsha|China
ZSAM|XMN|Xiamen Gaoqi International Airport|Xiamen|China
RCTP|TPE|Taiwan Taoyuan International Airport|Taipei|Taiwan
RCSS|TSA|Taipei Songshan Airport|Taipei|Taiwan
RCKH|KHH|Kaohsiung International Airport|Kaohsiung|Taiwan
VMMC|MFM|Macau International Airport|Macau|Macau
RJTT|HND|Tokyo Haneda Airport|Tokyo|Japan
RJAA|NRT|Narita International Airport|Tokyo|Japan
RJBB|KIX|Kansai International Airport|Osaka|Japan
RJOO|ITM|Osaka International Airport (Itami)|Osaka|Japan
RJGG|NGO|Chubu Centrair International Airport|Nagoya|Japan
RJFF|FUK|Fukuoka Airport|Fukuoka|Japan
RJCC|CTS|New Chitose Airport|Sapporo|Japan
ROAH|OKA|Naha Airport|Okinawa|Japan
RKSI|ICN|Incheon International Airport|Seoul|South Korea
RKSS|GMP|Gimpo International Airport|Seoul|South Korea
RKPK|PUS|Gimhae International Airport|Busan|South Korea
RKPC|CJU|Jeju International Airport|Jeju|South Korea
WSSS|SIN|Singapore Changi Airport|Singapore|Singapore
WMKK|KUL|Kuala Lumpur International Airport|Kuala Lumpur|Malaysia
WIII|CGK|Soekarno-Hatta International Airport|Jakarta|Indonesia
WADD|DPS|Ngurah Rai International Airport|Bali|Indonesia
WARR|SUB|Juanda International Airport|Surabaya|Indonesia
VTBS|BKK|Suvarnabhumi Airport|Bangkok|Thailand
VTBD|DMK|Don Mueang International Airport|Bangkok|Thailand
VTSP|HKT|Phuket International Airport|Phuket|Thailand
VTCC|CNX|Chiang Mai International Airport|Chiang Mai|Thailand
VVTS|SGN|Tan Son Nhat International Airport|Ho Chi Minh City|Vietnam
VVNB|HAN|Noi Bai International Airport|Hanoi|Vietnam
VVDN|DAD|Da Nang International Airport|Da Nang|Vietnam
RPLL|MNL|Ninoy Aquino International Airport|Manila|Philippines
RPVM|CEB|Mactan-Cebu International Airport|Cebu|Philippines
VDPP|PNH|Phnom Penh International Airport|Phnom Penh|Cambodia
VDSR|REP|Siem Reap-Angkor International Airport|Siem Reap|Cambodia
VLVT|VTE|Wattay International Airport|Vientiane|Laos
VYYY|RGN|Yangon International Airport|Yangon|Myanmar
VGHS|DAC|Hazrat Shahjalal International Airport|Dhaka|Bangladesh
VIDP|DEL|Indira Gandhi International Airport|Delhi|India
VABB|BOM|Chhatrapati Shivaji Maharaj International Airport|Mumbai|India
VOBL|BLR|Kempegowda International Airport|Bengaluru|India
VOMM|MAA|Chennai International Airport|Chennai|India
VECC|CCU|Netaji Subhas Chandra Bose International Airport|Kolkata|India
VOHS|HYD|Rajiv Gandhi International Airport|Hyderabad|India
VCBI|CMB|Bandaranaike International Airport|Colombo|Sri Lanka
VNKT|KTM|Tribhuvan International Airport|Kathmandu|Nepal
OPKC|KHI|Jinnah International Airport|Karachi|Pakistan
OPLA|LHE|Allama Iqbal International Airport|Lahore|Pakistan
OPIS|ISB|Islamabad International Airport|Islamabad|Pakistan
VRMM|MLE|Velana International Airport|Male|Maldives
UTTT|TAS|Tashkent International Airport|Tashkent|Uzbekistan
UAAA|ALA|Almaty International Airport|Almaty|Kazakhstan
ZMCK|UBN|Chinggis Khaan International Airport|Ulaanbaatar|Mongolia
YSSY|SYD|Sydney Kingsford Smith Airport|Sydney|Australia
YMML|MEL|Melbourne Airport|Melbourne|Australia
YBBN|BNE|Brisbane Airport|Brisbane|Australia
YPPH|PER|Perth Airport|Perth|Australia
YPAD|ADL|Adelaide Airport|Adelaide|Australia
YSCB|CBR|Canberra Airport|Canberra|Australia
YBCG|OOL|Gold Coast Airport|Gold Coast|Australia
NZAA|AKL|Auckland Airport|Auckland|New Zealand
NZWN|WLG|Wellington Airport|Wellington|New Zealand
NZCH|CHC|Christchurch Airport|Christchurch|New Zealand
NZQN|ZQN|Queenstown Airport|Queenstown|New Zealand
NFFN|NAN|Nadi International Airport|Nadi|Fiji
NTAA|PPT|Faa'a International Airport|Papeete|French Polynesia
AYPY|POM|Jacksons International Airport|Port Moresby|Papua New Guinea
`;
  const fold = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const LIST = RAW.trim().split('\n').map(line => { const [icao, iata, name, city, country] = line.split('|'); return { icao, iata, code: icao, name, city, country, where: `${city}, ${country}`, text: fold(`${name} ${city} ${country} ${icao} ${iata}`), cityText: fold(city), nameText: fold(name), words: fold(`${name} ${city} ${country} ${icao} ${iata}`).split(/[^a-z0-9']+/).filter(Boolean) }; });
  const BY_CODE = new Map(); for (const airport of LIST) { BY_CODE.set(airport.icao, airport); BY_CODE.set(airport.iata, airport); }
  const hasCode = code => BY_CODE.has(String(code || '').toUpperCase());
  const lookup = code => BY_CODE.get(String(code || '').toUpperCase()) || null;
  // Airports whose name or city matches the words typed (every word must be found), best matches first: the city itself, then names that
  // start with the text, then names containing it, then the rest. Matching the country alone ("Japan") is allowed but ranks last.
  function search(text, limit = 12) {
    const query = fold(text).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); if (query.length < 2) return [];
    const words = query.split(' ').filter(word => word.length > 0), results = [];
    for (const airport of LIST) {
      if (!words.every(word => airport.words.some(candidate => candidate.startsWith(word)))) continue;   // each typed word starts a word of the name, city, country or a code ("nice" is not "Venice")
      let score = 1;
      if (airport.cityText === query) score += 100; else if (airport.cityText.startsWith(query)) score += 70; else if (words.every(word => airport.cityText.includes(word))) score += 50;
      if (airport.nameText.startsWith(query)) score += 80; else if (airport.nameText.includes(query)) score += 40; else if (words.every(word => airport.nameText.includes(word))) score += 20;
      results.push({ airport, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit).map(({ airport }) => ({ code: airport.icao, icao: airport.icao, iata: airport.iata, name: airport.name, where: airport.where }));
  }
  // Some well known airports to suggest while typing.
  const SUGGEST = ['KJFK', 'KLAX', 'KSFO', 'EGLL', 'LFPG', 'EDDF', 'OMDB', 'WSSS', 'YSSY', 'RKSI', 'ZBAA', 'VHHH', 'RJTT', 'RJBB', 'KORD', 'LSZH'].map(code => LIST.find(airport => airport.icao === code)).filter(Boolean).map(airport => [airport.icao, `${airport.name} (${airport.iata})`]);
  return { LIST, search, hasCode, lookup, SUGGEST };
});
