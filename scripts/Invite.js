(function(){
angular
.module('AppbaseDashboard')
.controller('invite', InviteCtrl);

function InviteCtrl($routeParams, stringManipulation, $scope, session, $rootScope, $location, $timeout){
  $rootScope.db_loading = true;
  if($scope.devProfile = session.getProfile()) {
    Appbase.credentials("inviteafriend", "f1f5e9662a9bae3ce3d7f2b2b8869f4a");
    var userProfile = JSON.parse(localStorage.getItem('devProfile'));
    var email = userProfile.email.replace('@','');
    var usersNS = Appbase.ns("users");
    var inviteNS = Appbase.ns("sentinvites");
    var userV = usersNS.v(email);
    var inviteLink = ['http://appbase.io/?utm_campaign=viral&utm_content=',btoa(userProfile.email),'&utm_medium=share_link&utm_source=appbase'].join('');
    $("#subject").val('You have been invited to try Appbase by ' + userProfile.email)
    $('#invite-link').val(inviteLink);

    $('#invited-users').on('click','.resend',function(e){
      $('#email').val($(this).data('email'));
      $('#form-invite-friends').submit();
    });

    userV.on('edge_added', function onComplete(err, vref,eref) {
      if (err) 
        console.log(err);
      else {
        vref.on('properties', function (err,ref,userSnap) {
            if (err) {
              console.log(err);
            } else {
              if(!$('#'+eref.priority()).length) {
                
                $('#invited-users').append('<li id="'+eref.priority()+'"">'+ userSnap.properties().email +': <span class="pull-right resend-link"></span> <em class="status">'+userSnap.properties().status+'<em> <span class="pull-right resend-link"></span>');
                if(userSnap.properties().status == 'invited') {
                  $('#'+eref.priority()+' > .resend-link').html('<a class="resend" data-email="'+userSnap.properties().email+'" >Resed Invitation</a>');
                }
              } else {
                $('#'+eref.priority()+' > .status').text(userSnap.properties().status);

                if(userSnap.properties().status == 'registered') {
                  $('#'+eref.priority()+' > .resend-link').remove();
                }
              }
            }
        });
       }
    });

    $(function(){
      $('#form-invite-friends').submit( function(event) {

        $('#final-text').val([$('#text').val(),'<br><br> <a href="',inviteLink,'">Click here to join Appbase now.</a> or open this link on your browser: ', inviteLink, '.'].join(''));

        //send form data to server
        $.ajax({
          type: "POST",
          url: $(this).attr('action'),
          data: $( this ).serialize(),
          dataType: 'json',
          beforeSend: function(jqXHR,settings) {
            $('#ajax-loader').hide().removeClass('hide').slideDown('fast');
            $('#email-error').html('');
            console.log(jqXHR);
            console.log(settings);
          },
          complete: function(){
            $('#ajax-loader').hide();
          },
          success: function(data, status) {
            if(data.accepted){
              data.accepted.forEach(function(element,index){
                vertex = [email,element.replace(/@/g,'')].join('');

                //create new invited vertex and edge it to user
                var inviteV = inviteNS.v(vertex);
                inviteData = {
                    status : 'invited',
                    email: element
                  }
                inviteV.setData(inviteData,function(error,vref){
                  userV.setEdge(vref.name(),vref);
                  $('#email-sent').html(['<li>Invitation sent to: ',element,'</li>'].join(''));
                });
                
              });
            } else if (data.rejected) {
              data.accepted.forEach(function(element,index){
                $('#email-error').append(['<li>',element,'</li>'].join(''));
              });
            } else {
              $('#email-error').html('<li>An error has happened.</li>');
            }
          }
        });
        event.preventDefault();
      });
    });
  } {
    $rootScope.db_loading = false;
  }
}

})();