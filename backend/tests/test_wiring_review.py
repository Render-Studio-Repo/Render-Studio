from backend.services.wiring_review import review_schematic, normalize_questions, answers_context


def test_three_pi_wires_do_not_make_disconnected_motor_complete():
    parts=[{'id':x,'type':'breadboard' if x=='bb' else 'motor-driver' if x=='driver' else 'stepper' if x=='motor' else 'raspberry-pi','label':x} for x in ('pi','bb','driver','motor')]
    wires=[{'id':str(i),'from':{'componentId':'pi','pinId':pin},'to':{'componentId':'bb','pinId':hole}} for i,(pin,hole) in enumerate([('gnd','t-_0'),('gpio18','a5'),('gpio17','a10')])]
    result=review_schematic({'components':parts,'wires':wires})
    assert result['blocker']['blocked']
    assert 'motor is disconnected.' in result['blocker']['issues']
    assert 'driver is disconnected.' in result['blocker']['issues']
    assert result['followup_questions']


def test_unknown_named_terminal_is_not_a_valid_wire():
    parts=[{'id':'driver','type':'motor-driver','pin_layout_mode':'diagram','pin_layout':[{'id':'AC1'},{'id':'AC2'}],'required_connections':['AC1','AC2']}, {'id':'psu','type':'power-supply'}]
    result=review_schematic({'components':parts,'wires':[{'id':'power','from':{'componentId':'psu','pinId':'vcc'},'to':{'componentId':'driver','pinId':'vcc'}}]})
    assert any('no terminal named vcc' in i for i in result['blocker']['issues'])


def test_answered_complete_connection_has_no_blocker():
    assert review_schematic({'components':[{'id':'a','type':'sensor'},{'id':'b','type':'sensor'}],'wires':[{'from':{'componentId':'a','pinId':'out'},'to':{'componentId':'b','pinId':'in'}}]})['blocker'] is None


def test_targeted_questions_survive_and_answers_are_separate_context():
    question={'id':'logic-power','question':'How will you power the 24 V input?','options':['Converter','Separate supply']}
    result=review_schematic({'components':[],'wires':[],'followup_questions':[question]})
    assert result['blocker']['blocked']
    assert result['followup_questions'][0]['id']=='logic-power'
    assert '48V 25A' in answers_context([{'id':'supply','answer':'48V 25A'}])
    assert normalize_questions([None,{},'Voltage?'])[-1]['question']=='Voltage?'
